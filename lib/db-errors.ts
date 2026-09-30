/**
 * Database rules raise errors with messages written for people (for example
 * "Add at least one image before publishing"). Those are safe to show. Any
 * other database error gets the fallback text so internals never reach users.
 */
const USER_FACING_CODES = new Set(["P0001", "22023"]);

export function userFacingDbError(error: { code?: string; message: string }, fallback: string): string {
  return error.code && USER_FACING_CODES.has(error.code) ? error.message : fallback;
}
