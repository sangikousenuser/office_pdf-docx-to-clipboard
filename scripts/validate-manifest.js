import { readFile } from "node:fs/promises";

const manifest = await readFile("manifest.xml", "utf8");

const requiredSnippets = [
  "<OfficeApp",
  "<Hosts>",
  "<Host Name=\"Document\"",
  "<VersionOverrides",
  "<FunctionFile resid=\"Commands.Url\"",
  "<Action xsi:type=\"ExecuteFunction\">",
  "<FunctionName>exportAndCopy</FunctionName>"
];

for (const snippet of requiredSnippets) {
  if (!manifest.includes(snippet)) {
    throw new Error(`manifest.xml is missing required snippet: ${snippet}`);
  }
}

console.log("manifest.xml basic validation passed");
