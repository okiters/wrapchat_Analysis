// Node module hooks that let the golden harness import the real app modules
// outside Vite: resolves Vite's `?raw` imports, replaces `import.meta.env`
// with an env-backed object, and stubs the Supabase client (the harness never
// touches Supabase; it calls the Anthropic API directly).
import { readFile, access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

async function exists(url) {
  try {
    await access(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes("?raw")) {
    const url = new URL(specifier, context.parentURL);
    return { url: url.href, shortCircuit: true };
  }
  if (/\/supabase(\.js)?$/.test(specifier) && context.parentURL?.includes("/src/")) {
    return { url: "wrapchat:supabase-stub", shortCircuit: true };
  }
  // Vite resolves extensionless relative imports; Node does not. Retry with
  // .js / .jsx before giving up.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of [".js", ".jsx"]) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (await exists(candidate)) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "wrapchat:supabase-stub") {
    return {
      format: "module",
      source: "export const supabase = null;",
      shortCircuit: true,
    };
  }
  if (url.includes("?raw")) {
    const filePath = fileURLToPath(new URL(url.split("?")[0]));
    const text = await readFile(filePath, "utf8");
    return {
      format: "module",
      source: `export default ${JSON.stringify(text)};`,
      shortCircuit: true,
    };
  }
  const result = await nextLoad(url, context);
  if (result.format === "module" && result.source && String(url).includes("/src/")) {
    const source = result.source.toString();
    if (source.includes("import.meta.env")) {
      return {
        ...result,
        source: source.replaceAll("import.meta.env", "(globalThis.__WRAPCHAT_ENV__ ?? {})"),
      };
    }
  }
  return result;
}

export { pathToFileURL };
