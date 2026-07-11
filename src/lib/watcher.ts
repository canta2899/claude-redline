import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

// Watches the *parent directory*, not the file itself: editors commonly save by
// writing a temp file and renaming it over the target, which swaps the inode and
// would silently kill a file-level watch.
export function watchDocument(filePath: string, onChange: (content: string) => void): () => void {
  const abs = resolve(filePath);
  const dir = dirname(abs);
  const name = basename(abs);

  let timer: NodeJS.Timeout | null = null;
  const reload = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      readFile(abs, "utf8").then(
        (content) => onChange(content),
        () => onChange("")
      );
    }, 60);
  };

  const watcher = watch(dir, (_event, changed) => {
    // changed is null on some platforms — reload to be safe rather than miss it.
    if (changed === null || changed === name) reload();
  });

  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
