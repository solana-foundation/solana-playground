import { PgCommon } from "@/utils";

/** Where the ecosystem programs are listed, `public/programs/programs.json` */
export const PROGRAMS_URL = "/programs/programs.json";

/** One entry of `PROGRAMS_URL` */
export interface ProgramListing {
  name: string;
  description: string;
  repo: string;
  icon: string;
  framework: string;
  categories: string[];
}

const STRING_FIELDS = ["name", "description", "repo", "icon", "framework"];

const isListing = (entry: unknown): entry is ProgramListing => {
  if (typeof entry !== "object" || entry === null) return false;
  const fields = entry as Record<string, unknown>;
  return (
    STRING_FIELDS.every((f) => typeof fields[f] === "string") &&
    Array.isArray(fields.categories) &&
    fields.categories.every((c) => typeof c === "string")
  );
};

/**
 * The listing, checked: a body that is not a list of complete entries
 * rejects, so a caller shows its failure instead of rendering a shape it
 * cannot read
 */
export const fetchPrograms = async (): Promise<ProgramListing[]> => {
  const body: unknown = await PgCommon.fetchJSON(PROGRAMS_URL);
  if (!Array.isArray(body)) {
    throw new Error(`${PROGRAMS_URL} is not a list of programs`);
  }
  const bad = body.findIndex((entry) => !isListing(entry));
  if (bad !== -1) {
    throw new Error(`${PROGRAMS_URL}: entry ${bad} is not a program`);
  }
  return body;
};
