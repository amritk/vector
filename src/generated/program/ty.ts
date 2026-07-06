export type Ty = "Real" | "Int" | "Bool";

export const validateTyShape = (_input: unknown): boolean => false;

export const parseTy = (input: unknown): Ty => {
  if (typeof input !== "string") throw new Error("[Ty] expected string, got " + (input === null ? "null" : typeof input));
  return input as Ty;
};