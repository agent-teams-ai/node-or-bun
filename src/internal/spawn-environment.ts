/** Preserve an exact supplied map; inherit only when the caller omits it. */
export const copySpawnEnvironment = (
  inherited: Readonly<Record<string, string | undefined>>,
  supplied: Readonly<Record<string, string>> | undefined,
): Record<string, string> =>
  supplied === undefined
    ? Object.fromEntries(
        Object.entries(inherited).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      )
    : { ...supplied };
