import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * The chat turn forwarded to the Python agent.
 *
 * `history` used to be forwarded completely unvalidated and unbounded — the
 * Python side slices to the last 8 entries, but only after the whole payload
 * has been accepted, buffered and sent over the wire.
 */
export class ChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  symbol: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  exchange?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  history?: unknown[];

  /** The "reset chat" button — starts a fresh conversation instead of
   * continuing whatever session this symbol's turns would otherwise fall
   * into (see ChatSessionsService.resolveSessionId's 2-hour gap rule). */
  @IsOptional()
  @IsBoolean()
  newSession?: boolean;
}
