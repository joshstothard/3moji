import fs from "node:fs";
import path from "node:path";

/**
 * **There is no scheduled job, cron or sweep**, asserted as an absence.
 *
 * ADR-0004 decision 3 expires holds lazily — "evaluated when someone next
 * attempts to claim that Handle. There is no scheduled sweep" — and the
 * consequence the ADR accepts is that a Handle can appear held after its hold
 * has died until somebody tries it. A sweep added later to tidy that up would
 * not fail any other test in the repository: it would simply make the product
 * behave differently from its own decision record.
 *
 * So the rule is pinned where a sweep would have to register itself, which for
 * this stack is two places and only two: a scheduling dependency in a
 * workspace `package.json`, or a `crons` array in a `vercel.json`
 * ([ADR-0006](../../../../docs/adr/0006-nextjs-on-vercel-is-the-whole-application.md)
 * makes Vercel the whole deployment). Adding either is then a deliberate
 * change, with this test and the ADR in the diff.
 *
 * **Deliberately not a grep for `setInterval`/`setTimeout`.** A timer is
 * legitimate in a dozen unrelated places — debounces, retries, test helpers —
 * so that assertion would go red on somebody's unrelated PR and be deleted,
 * which is worse than not having it. GitHub Actions `schedule:` triggers are
 * out of scope for the same reason: the repository already has a nightly
 * security workflow, and a CI schedule is not a hold sweep.
 *
 * Every assertion below is paired with a count, because a test that quietly
 * stopped finding the files it reads would be vacuously green — the failure
 * mode `quality-strategy.md` records for the `DATABASE_URL` guard.
 */
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

/** Packages that exist to run something on a schedule. */
const SCHEDULERS = [
  "node-cron",
  "cron",
  "croner",
  "node-schedule",
  "agenda",
  "bree",
  "bullmq",
  "bull",
  "@vercel/cron",
];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** The workspace roots, resolved from the filesystem rather than listed here. */
function workspaceDirectories(): string[] {
  const directories = [REPO_ROOT];
  for (const group of ["apps", "packages"]) {
    const parent = path.join(REPO_ROOT, group);
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(path.join(parent, entry.name));
    }
  }
  return directories;
}

/**
 * A manifest's dependency names, read as `unknown` and narrowed.
 *
 * `JSON.parse` gives `any`, which the package forbids, so the value is taken as
 * `unknown` and every step down to the keys is checked.
 */
function dependencyNames(manifest: string): string[] {
  const parsed: unknown = JSON.parse(manifest);
  if (typeof parsed !== "object" || parsed === null) return [];
  const names: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    if (!(field in parsed)) continue;
    const block: unknown = Reflect.get(parsed, field);
    if (typeof block !== "object" || block === null) continue;
    names.push(...Object.keys(block));
  }
  return names;
}

describe("lazy hold expiry has nothing scheduled behind it", () => {
  it("declares no scheduling dependency in any workspace", () => {
    const manifests = workspaceDirectories()
      .map((directory) => path.join(directory, "package.json"))
      .filter((file) => fs.existsSync(file));

    // Proof it looked: root plus the workspaces this monorepo is made of.
    expect(manifests.length).toBeGreaterThanOrEqual(5);

    const found = manifests.flatMap((file) =>
      dependencyNames(fs.readFileSync(file, "utf8"))
        .filter((name) => SCHEDULERS.includes(name))
        .map((name) => `${path.relative(REPO_ROOT, file)}: ${name}`),
    );

    expect(found).toEqual([]);
  });

  it("registers no cron in a Vercel configuration", () => {
    const candidates = workspaceDirectories().map((directory) =>
      path.join(directory, "vercel.json"),
    );

    // Proof it looked at the places a vercel.json could be, whether or not one
    // exists today: if a later PR adds the file, this test reads it.
    expect(candidates.length).toBeGreaterThanOrEqual(5);

    const withCrons = candidates
      .filter((file) => fs.existsSync(file))
      .filter((file) => {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        return (
          typeof parsed === "object" && parsed !== null && "crons" in parsed
        );
      })
      .map((file) => path.relative(REPO_ROOT, file));

    expect(withCrons).toEqual([]);
  });
});
