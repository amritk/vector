// Bun's `with { type: "text" }` loader returns the file's contents as a string.
// bun-types declares `*.txt`; these cover the other files vector imports as text.
declare module "*.md" {
  const text: string;
  export default text;
}
declare module "*/LICENSE" {
  const text: string;
  export default text;
}
