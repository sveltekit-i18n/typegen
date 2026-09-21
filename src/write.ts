import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes only when the bytes differ.
 *
 * The artifact lands inside the tree the dev server watches, so an
 * unconditional write would announce a change, regenerate, and write again.
 * Comparing first is what makes the loop settle, and it is also why `emit`
 * sorts its keys: the same catalogue has to produce the same bytes.
 */
export const writeIfChanged = async (path: string, contents: string): Promise<boolean> => {
  const current = await readFile(path, 'utf8').catch(() => undefined);

  if (current === contents) return false;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');

  return true;
};
