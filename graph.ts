import { cache, resolve as resolveWithCache } from "./cache.ts";
import { path, Sha256, ImportMap, fs } from "./deps.ts";
import type { Loader } from "./plugins/loader.ts";
import { isURL } from "./_helpers.ts";

export interface Imports {
  [input: string]: { dynamic: boolean };
}
export interface Exports {
  [input: string]: string[];
}

export interface GraphEntry {
  path: string;
  output: string;
  imports: Imports;
  exports: Exports;
}

export interface Graph {
  [input: string]: GraphEntry;
}

export interface InputMap {
  [input: string]: string;
}

export interface FileMap {
  [input: string]: string;
}

export function getOutput(input: string, fileMap: FileMap, baseURL: string) {
  return fileMap[input] = fileMap[input] ||
    `${path.join(baseURL, new Sha256().update(input).hex())}.js`;
}

export async function getSource(
  input: string,
  inputMap: InputMap,
  importMap: ImportMap,
): Promise<string> {
  if (!inputMap[input]) {
    let filePath = input;
    if (isURL(filePath)) {
      await cache(filePath, { importMap });
      filePath = resolveWithCache(filePath);
    }
    inputMap[input] = await Deno.readTextFile(filePath);
  }
  return inputMap[input];
}

export async function createGraph(
  inputMap: InputMap,
  loaders: Loader[],
  {
    graph = {},
    fileMap = {},
    baseURL = "",
    importMap = { imports: {} },
    reload = false,
  }: {
    graph?: Graph;
    fileMap?: FileMap;
    baseURL?: string;
    importMap?: ImportMap;
    reload?: boolean;
  } = {},
) {
  const queue = Object.keys(inputMap);
  const checkedInputs: Set<string> = new Set();

  loop:
  while (queue.length) {
    const input = queue.pop()!;
    if (checkedInputs.has(input)) continue;
    checkedInputs.add(input);
    const resolvedPath = isURL(input) ? resolveWithCache(input) : input;

    let entry = graph[input];
    if (!reload && entry) {
      queue.push(...Object.keys(entry.imports));
      queue.push(
        ...Object.keys(entry.exports),
      );
    } else {
      const source = await getSource(input, inputMap, importMap);
      for (const loader of loaders) {
        if (loader.test(input)) {
          const result = await loader.fn(input, source, { importMap });
          entry = graph[input] = {
            path: resolvedPath,
            output: getOutput(input, fileMap, baseURL),
            imports: {},
            exports: {},
            ...result,
          };
          for (const dependency of Object.keys(entry.imports)) {
            if (!isURL(dependency) && !await fs.exists(dependency)) {
              throw Error(`file '${input}' import not found: '${dependency}'`);
            }
            queue.push(dependency);
          }
          for (const dependency of Object.keys(entry.exports)) {
            if (!isURL(dependency) && !await fs.exists(dependency)) {
              throw Error(`file '${input}' export not found: '${dependency}'`);
            }
            queue.push(dependency);
          }
          continue loop;
        }
      }
    }
  }
  return graph;
}
