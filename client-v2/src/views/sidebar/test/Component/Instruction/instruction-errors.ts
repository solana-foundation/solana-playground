import type { GeneratableInstruction } from "../../../../../utils/program-interaction";

/** Whether any argument or account holds an error or an empty custom value */
export const hasInstructionErrors = (
  values: GeneratableInstruction["values"]
) =>
  Object.values(values).reduce((acc, value) => {
    if (Array.isArray(value)) {
      acc ||= value.some(
        (v) =>
          v.error || (v.generator.type === "Custom" && v.generator.value === "")
      );
    }

    return acc;
  }, false);
