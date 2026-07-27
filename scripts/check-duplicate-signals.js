/**
 * Pre-deploy check: can the unique signal index actually build?
 *
 * `SignalSchema` declares a unique index on (symbol, generatedAt, direction) to
 * make at-least-once SQS redelivery idempotent. Mongoose builds indexes in the
 * BACKGROUND, and if the collection already contains rows that violate
 * uniqueness the build fails **quietly** — the app starts, reports healthy, and
 * has no idempotency at all. Nothing surfaces it.
 *
 * Run this before deploying. It reports duplicates and, with --fix, keeps the
 * oldest row of each group and deletes the rest.
 *
 *   node scripts/check-duplicate-signals.js
 *   node scripts/check-duplicate-signals.js --fix
 *
 * Reads MONGODB_URI from the environment or .env.
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return null;
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('MONGODB_URI='));
  return line ? line.slice('MONGODB_URI='.length).trim().replace(/^["']|["']$/g, '') : null;
}

async function main() {
  const fix = process.argv.includes('--fix');
  const uri = loadUri();
  if (!uri) {
    console.error('MONGODB_URI not set and not found in .env');
    process.exit(2);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const signals = client.db().collection('signals');

  const total = await signals.countDocuments();
  const groups = await signals
    .aggregate([
      {
        $group: {
          _id: { symbol: '$symbol', generatedAt: '$generatedAt', direction: '$direction' },
          ids: { $push: '$_id' },
          n: { $sum: 1 },
        },
      },
      { $match: { n: { $gt: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  console.log(`signals in collection: ${total}`);
  console.log(`duplicate (symbol, generatedAt, direction) groups: ${groups.length}`);

  if (groups.length === 0) {
    // Confirm the index is actually present, not merely declared in the schema.
    const idx = await signals.indexes();
    const unique = idx.find(
      (i) => i.unique && i.key.symbol && i.key.generatedAt && i.key.direction,
    );
    console.log(
      unique
        ? `unique index present: ${unique.name}`
        : 'unique index NOT present — it will build on next boot, and now can',
    );
    await client.close();
    return;
  }

  const extra = groups.reduce((a, g) => a + g.n - 1, 0);
  console.log(`rows that must go before the index can build: ${extra}\n`);
  for (const g of groups.slice(0, 20)) {
    console.log(`  ${g._id.symbol} ${g._id.direction} @ ${g._id.generatedAt} -> ${g.n} copies`);
  }
  if (groups.length > 20) console.log(`  ... and ${groups.length - 20} more groups`);

  if (!fix) {
    console.log('\nRe-run with --fix to keep the oldest of each group and delete the rest.');
    await client.close();
    process.exit(1);
  }

  // Keep the FIRST inserted row of each group: it is the one whose outcome any
  // existing performance figure was computed from.
  let deleted = 0;
  for (const g of groups) {
    const sorted = [...g.ids].sort((a, b) =>
      a.getTimestamp() - b.getTimestamp() || String(a).localeCompare(String(b)),
    );
    const res = await signals.deleteMany({ _id: { $in: sorted.slice(1) } });
    deleted += res.deletedCount;
  }
  console.log(`\ndeleted ${deleted} duplicate rows — the unique index can now build`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
