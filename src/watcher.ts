import { basename, dirname, resolve } from "@std/path";

// Watches the *parent directory*, not the file itself: editors commonly save by
// writing a temp file and renaming it over the target, which swaps the inode and
// would silently kill a file-level watch.
export function watchDocument(
  filePath: string,
  onChange: (content: string) => void,
): () => void {
  const abs = resolve(filePath);
  const dir = dirname(abs);
  const name = basename(abs);

  const watcher = Deno.watchFs(dir);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const reload = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      Deno.readTextFile(abs).then(
        (content) => onChange(content),
        () => onChange(""),
      );
    }, 60);
  };

  (async () => {
    for await (const event of watcher) {
      if (event.paths.some((p) => basename(p) === name)) reload();
    }
  })();

  return () => {
    if (timer !== null) clearTimeout(timer);
    watcher.close();
  };
}
