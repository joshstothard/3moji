// Tests for scripts/neon-preview-cleanup.mjs. Run with `npm run test:scripts`.
//
// .github/workflows/neon-preview-cleanup.yml (#258) asks this module every
// question that has a right answer, so the answers are tested here without a
// Neon project, a pull request or a runner. Written from the issue's
// acceptance criteria, not from the implementation:
//
// - until the owner sets NEON_CLEANUP_ENABLED=true, a run is a green no-op;
// - a pull request from a fork or from Dependabot gets no secrets, and is
//   skipped rather than failed;
// - once enabled, a missing NEON_API_KEY or NEON_PROJECT_ID fails the run and
//   is named, and no value is ever printed;
// - on close, only the branch named exactly `preview/<head ref>` is deleted;
// - the sweep deletes every `preview/` branch whose git branch has no open
//   pull request, and never `main`, the default branch or a branch without the
//   prefix;
// - a branch that is already gone is a success; a refused delete is not.
//
// Every value below is a placeholder, and the output tests assert that the API
// key and the response bodies are never printed.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import {
  CONFIG_NAMES,
  clean,
  decideCleanup,
  isDeletablePreview,
  previewBranchName,
  selectBranchesForClose,
  selectBranchesToSweep,
} from "./neon-preview-cleanup.mjs";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "neon-preview-cleanup.mjs",
);

const API_KEY = "example-neon-api-key-not-real";
const PROJECT_ID = "example-project-12345678";
const REPOSITORY = "joshstothard/3moji";
const GITHUB_TOKEN = "example-github-token-not-real";
/** Put in every response body, to prove no body is ever printed. */
const BODY_SENTINEL = "response-body-sentinel-never-printed";

const closeEnv = (overrides = {}) => ({
  NEON_CLEANUP_ENABLED: "true",
  NEON_API_KEY: API_KEY,
  NEON_PROJECT_ID: PROJECT_ID,
  EVENT_NAME: "pull_request",
  REPOSITORY,
  PR_HEAD_REPO: REPOSITORY,
  ACTOR: "joshstothard",
  HEAD_REF: "240-multipart",
  PR_NUMBER: "258",
  GITHUB_TOKEN,
  ...overrides,
});

const sweepEnv = (overrides = {}) =>
  closeEnv({
    EVENT_NAME: "workflow_dispatch",
    PR_HEAD_REPO: "",
    HEAD_REF: "",
    ...overrides,
  });

const branch = (id, name, extra = {}) => ({
  id,
  name,
  default: false,
  protected: false,
  ...extra,
});

describe("CONFIG_NAMES", () => {
  it("is the API key secret and the project variable", () => {
    assert.deepEqual([...CONFIG_NAMES].sort(), [
      "NEON_API_KEY",
      "NEON_PROJECT_ID",
    ]);
  });
});

describe("decideCleanup", () => {
  it("skips until NEON_CLEANUP_ENABLED is true, whatever else is set", () => {
    for (const value of [undefined, "", "false", "yes", "1"]) {
      const decision = decideCleanup(closeEnv({ NEON_CLEANUP_ENABLED: value }));
      assert.equal(decision.action, "skip", String(value));
      assert.match(decision.reason, /NEON_CLEANUP_ENABLED/);
    }
  });

  it("skips before setup even with no secrets at all", () => {
    const decision = decideCleanup({ EVENT_NAME: "pull_request" });
    assert.equal(decision.action, "skip");
  });

  it("accepts true in any case, with surrounding space", () => {
    const decision = decideCleanup(
      closeEnv({ NEON_CLEANUP_ENABLED: " TRUE " }),
    );
    assert.equal(decision.action, "run");
  });

  it("skips a pull request from a fork, which gets no secrets, rather than failing", () => {
    const decision = decideCleanup(
      closeEnv({
        PR_HEAD_REPO: "someone/3moji",
        NEON_API_KEY: "",
        NEON_PROJECT_ID: "",
      }),
    );
    assert.equal(decision.action, "skip");
    assert.match(decision.reason, /fork/i);
  });

  it("skips a pull request whose fork was deleted (no head repository)", () => {
    const decision = decideCleanup(
      closeEnv({ PR_HEAD_REPO: "", NEON_API_KEY: "" }),
    );
    assert.equal(decision.action, "skip");
    assert.match(decision.reason, /fork/i);
  });

  it("skips a run Dependabot triggered, which gets no secrets, rather than failing", () => {
    const decision = decideCleanup(
      closeEnv({ ACTOR: "dependabot[bot]", NEON_API_KEY: "" }),
    );
    assert.equal(decision.action, "skip");
    assert.match(decision.reason, /Dependabot/);
  });

  it("fails naming both settings when neither is set", () => {
    const decision = decideCleanup(
      closeEnv({ NEON_API_KEY: "", NEON_PROJECT_ID: "  " }),
    );
    assert.equal(decision.action, "fail");
    assert.deepEqual(decision.missing, ["NEON_API_KEY", "NEON_PROJECT_ID"]);
    assert.match(decision.reason, /NEON_API_KEY/);
    assert.match(decision.reason, /NEON_PROJECT_ID/);
  });

  it("fails naming only the one that is missing, and never prints a value", () => {
    const decision = decideCleanup(sweepEnv({ NEON_PROJECT_ID: undefined }));
    assert.equal(decision.action, "fail");
    assert.deepEqual(decision.missing, ["NEON_PROJECT_ID"]);
    assert.doesNotMatch(decision.reason, new RegExp(API_KEY));
  });

  it("fails a project ID that could not be a Neon project ID, without printing it", () => {
    for (const bad of [
      "../../projects/other",
      "example project",
      "https://console.neon.tech/app/projects/x",
    ]) {
      const decision = decideCleanup(sweepEnv({ NEON_PROJECT_ID: bad }));
      assert.equal(decision.action, "fail", bad);
      assert.match(decision.reason, /NEON_PROJECT_ID/);
      assert.ok(!decision.reason.includes(bad), bad);
    }
  });

  it("fails a close with no usable head ref", () => {
    const decision = decideCleanup(closeEnv({ HEAD_REF: "" }));
    assert.equal(decision.action, "fail");
  });

  it("fails an event it was not written for", () => {
    const decision = decideCleanup(closeEnv({ EVENT_NAME: "push" }));
    assert.equal(decision.action, "fail");
  });

  it("runs a close for a pull request from this repository", () => {
    const decision = decideCleanup(closeEnv());
    assert.equal(decision.action, "run");
    assert.equal(decision.mode, "close");
  });

  it("runs a sweep for a manual run, with no head ref", () => {
    const decision = decideCleanup(sweepEnv());
    assert.equal(decision.action, "run");
    assert.equal(decision.mode, "sweep");
  });
});

describe("previewBranchName", () => {
  it("prefixes the head ref with preview/", () => {
    assert.equal(
      previewBranchName("240-multipart-html-email"),
      "preview/240-multipart-html-email",
    );
  });

  it("keeps slashes, as the integration does", () => {
    assert.equal(
      previewBranchName("chore/adr-0011-canonical-aliases"),
      "preview/chore/adr-0011-canonical-aliases",
    );
  });

  it("refuses anything that is not a usable git branch name", () => {
    for (const bad of [
      undefined,
      "",
      "   ",
      "has space",
      "tab\there",
      "line\nbreak",
      "a..b",
      "/leading",
      "trailing/",
      "semi;colon:x",
      "$(whoami)",
    ]) {
      assert.equal(previewBranchName(bad), undefined, JSON.stringify(bad));
    }
  });
});

describe("isDeletablePreview", () => {
  it("accepts an ordinary preview branch", () => {
    assert.equal(isDeletablePreview(branch("br-1", "preview/x")), true);
  });

  it("never accepts main, the default branch, a protected branch, or a name without the prefix", () => {
    for (const b of [
      branch("br-main", "main", { default: true }),
      branch("br-main2", "main"),
      branch("br-dev", "development"),
      branch("br-p", "preview/x", { default: true }),
      branch("br-q", "preview/y", { protected: true }),
      branch("br-case", "Preview/x"),
      branch("br-bare", "preview/"),
      branch("br-inner", "not-preview/x"),
      branch("", "preview/no-id"),
      { name: "preview/no-id-at-all" },
      null,
    ]) {
      assert.equal(isDeletablePreview(b), false, JSON.stringify(b));
    }
  });
});

const FIXTURE = [
  branch("br-main", "main", { default: true }),
  branch("br-240", "preview/240-multipart"),
  branch("br-240-html", "preview/240-multipart-html-email"),
  branch("br-chore", "preview/chore/adr-0011-canonical"),
  branch("br-open", "preview/feature/still-open"),
  branch("br-dev", "development"),
  branch("br-default-preview", "preview/was-made-default", { default: true }),
];

describe("selectBranchesForClose", () => {
  it("selects only the branch whose name matches exactly, not one it is a prefix of", () => {
    const selected = selectBranchesForClose(FIXTURE, "240-multipart", []);
    assert.deepEqual(
      selected.map((b) => b.id),
      ["br-240"],
    );
  });

  it("selects a branch whose head ref has a slash", () => {
    const selected = selectBranchesForClose(
      FIXTURE,
      "chore/adr-0011-canonical",
      [],
    );
    assert.deepEqual(
      selected.map((b) => b.id),
      ["br-chore"],
    );
  });

  it("selects nothing when another open pull request still uses the branch", () => {
    assert.deepEqual(
      selectBranchesForClose(FIXTURE, "240-multipart", ["240-multipart"]),
      [],
    );
  });

  it("selects nothing for a head ref named main, or one mapping to the default branch", () => {
    assert.deepEqual(selectBranchesForClose(FIXTURE, "main", []), []);
    assert.deepEqual(
      selectBranchesForClose(FIXTURE, "was-made-default", []),
      [],
    );
  });

  it("selects nothing for an unusable head ref", () => {
    assert.deepEqual(selectBranchesForClose(FIXTURE, "", []), []);
  });
});

describe("selectBranchesToSweep", () => {
  it("selects every preview branch with no open pull request, and nothing else", () => {
    const selected = selectBranchesToSweep(FIXTURE, ["feature/still-open"]);
    assert.deepEqual(selected.map((b) => b.id).sort(), [
      "br-240",
      "br-240-html",
      "br-chore",
    ]);
  });

  it("keeps a branch whose git branch has an open pull request, matching exactly", () => {
    const selected = selectBranchesToSweep(FIXTURE, [
      "240-multipart",
      "feature/still-open",
    ]);
    assert.deepEqual(selected.map((b) => b.id).sort(), [
      "br-240-html",
      "br-chore",
    ]);
  });

  it("selects nothing from a project with no preview branches", () => {
    assert.deepEqual(
      selectBranchesToSweep(
        [branch("br-main", "main", { default: true }), branch("br-dev", "dev")],
        [],
      ),
      [],
    );
  });
});

/**
 * A fake of the Neon and GitHub APIs. Records every request, and answers from
 * the given state. Every response body carries BODY_SENTINEL.
 */
function fakeApis({
  branches = FIXTURE,
  pages = undefined,
  openPulls = [],
  deleteStatus = () => 200,
  listStatus = 200,
  pullsStatus = 200,
  listBody = undefined,
} = {}) {
  const requests = [];
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    requests.push({ method, url, headers });

    if (url.hostname === "api.github.com") {
      if (pullsStatus !== 200) {
        return json({ message: BODY_SENTINEL }, pullsStatus);
      }
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "30");
      const start = (page - 1) * perPage;
      // A string is another pull request's head ref; { ref, number } names
      // the pull request too.
      return json(
        openPulls.slice(start, start + perPage).map((pull, index) => ({
          number: typeof pull === "string" ? 1000 + start + index : pull.number,
          head: { ref: typeof pull === "string" ? pull : pull.ref },
          title: BODY_SENTINEL,
        })),
      );
    }

    if (url.hostname !== "console.neon.tech") {
      throw new Error(`unexpected host ${url.hostname}`);
    }

    const match = url.pathname.match(
      /^\/api\/v2\/projects\/([^/]+)\/branches(?:\/([^/]+))?$/,
    );
    if (match === null) throw new Error(`unexpected path ${url.pathname}`);

    if (method === "GET" && match[2] === undefined) {
      if (listStatus !== 200) {
        return json({ message: BODY_SENTINEL }, listStatus);
      }
      if (listBody !== undefined) return json(listBody);
      if (pages !== undefined) {
        const cursor = url.searchParams.get("cursor");
        const index = cursor === null ? 0 : Number(cursor.replace("c", ""));
        const next = index + 1 < pages.length ? `c${index + 1}` : undefined;
        return json({
          branches: pages[index],
          pagination: next === undefined ? {} : { next },
          note: BODY_SENTINEL,
        });
      }
      return json({ branches, pagination: {}, note: BODY_SENTINEL });
    }

    if (method === "DELETE" && match[2] !== undefined) {
      const id = decodeURIComponent(match[2]);
      const status = deleteStatus(id);
      if (status === 204) return new Response(null, { status });
      return json({ message: BODY_SENTINEL, branch: { id } }, status);
    }

    throw new Error(`unexpected ${method} ${url.pathname}`);
  }

  return { fetch: fetchImpl, requests };
}

function captureLog() {
  const lines = [];
  return {
    lines,
    log: (line) => lines.push(String(line)),
    text: () => lines.join("\n"),
  };
}

const deleted = (requests) =>
  requests
    .filter((r) => r.method === "DELETE")
    .map((r) => decodeURIComponent(r.url.pathname.split("/").pop()));

function assertNothingSecretPrinted(text) {
  assert.ok(!text.includes(API_KEY), "the API key was printed");
  assert.ok(!text.includes(GITHUB_TOKEN), "the GitHub token was printed");
  assert.ok(!text.includes(BODY_SENTINEL), "a response body was printed");
  assert.ok(!text.includes(PROJECT_ID), "the project ID was printed");
}

describe("clean", () => {
  it("on close, deletes only the exact preview branch, with the key as a bearer token", async () => {
    const apis = fakeApis();
    const out = captureLog();
    const code = await clean(closeEnv(), { fetch: apis.fetch, log: out.log });
    assert.equal(code, 0, out.text());
    assert.deepEqual(deleted(apis.requests), ["br-240"]);
    for (const r of apis.requests.filter(
      (req) => req.url.hostname === "console.neon.tech",
    )) {
      assert.equal(r.headers.get("authorization"), `Bearer ${API_KEY}`);
      assert.equal(r.url.pathname.split("/")[4], PROJECT_ID);
    }
    assert.match(out.text(), /preview\/240-multipart\b/);
    assertNothingSecretPrinted(out.text());
  });

  it("never sends the Neon key to GitHub, or the GitHub token to Neon", async () => {
    const apis = fakeApis();
    await clean(sweepEnv(), { fetch: apis.fetch, log: () => {} });
    for (const r of apis.requests) {
      const auth = r.headers.get("authorization") ?? "";
      if (r.url.hostname === "api.github.com") {
        assert.ok(!auth.includes(API_KEY));
      } else {
        assert.ok(!auth.includes(GITHUB_TOKEN));
      }
    }
  });

  it("on close, deletes nothing and succeeds when there is no such branch", async () => {
    const apis = fakeApis();
    const out = captureLog();
    const code = await clean(closeEnv({ HEAD_REF: "no-deployment-ever" }), {
      fetch: apis.fetch,
      log: out.log,
    });
    assert.equal(code, 0, out.text());
    assert.deepEqual(deleted(apis.requests), []);
  });

  // GitHub's list can still show a pull request as open the moment its close
  // event fires. Counting it would keep its own branch for ever.
  it("on close, ignores the closing pull request if GitHub still lists it as open", async () => {
    const apis = fakeApis({
      openPulls: [{ ref: "240-multipart", number: 258 }],
    });
    const out = captureLog();
    const code = await clean(closeEnv(), { fetch: apis.fetch, log: out.log });
    assert.equal(code, 0, out.text());
    assert.deepEqual(deleted(apis.requests), ["br-240"]);
  });

  it("on close, keeps the branch when another open pull request uses the same git branch", async () => {
    const apis = fakeApis({ openPulls: ["240-multipart"] });
    const code = await clean(closeEnv(), { fetch: apis.fetch, log: () => {} });
    assert.equal(code, 0);
    assert.deepEqual(deleted(apis.requests), []);
  });

  it("sweeps every preview branch with no open pull request, and nothing else", async () => {
    const apis = fakeApis({ openPulls: ["feature/still-open"] });
    const out = captureLog();
    const code = await clean(sweepEnv(), { fetch: apis.fetch, log: out.log });
    assert.equal(code, 0, out.text());
    assert.deepEqual(deleted(apis.requests).sort(), [
      "br-240",
      "br-240-html",
      "br-chore",
    ]);
    assertNothingSecretPrinted(out.text());
  });

  it("reads every page of open pull requests before deciding what to sweep", async () => {
    const many = Array.from({ length: 150 }, (_, i) => `filler-${i}`);
    const apis = fakeApis({ openPulls: [...many, "240-multipart"] });
    await clean(sweepEnv(), { fetch: apis.fetch, log: () => {} });
    assert.ok(!deleted(apis.requests).includes("br-240"));
  });

  it("reads every page of Neon branches", async () => {
    const apis = fakeApis({
      pages: [
        [branch("br-main", "main", { default: true })],
        [branch("br-late", "preview/late-page")],
      ],
    });
    const code = await clean(sweepEnv(), { fetch: apis.fetch, log: () => {} });
    assert.equal(code, 0);
    assert.deepEqual(deleted(apis.requests), ["br-late"]);
  });

  it("counts a branch that is already gone as a success", async () => {
    for (const status of [204, 404]) {
      const apis = fakeApis({ deleteStatus: () => status });
      const out = captureLog();
      const code = await clean(closeEnv(), { fetch: apis.fetch, log: out.log });
      assert.equal(code, 0, `${status}: ${out.text()}`);
    }
  });

  it("fails a refused delete, still tries the others, and prints no response body", async () => {
    const apis = fakeApis({
      openPulls: ["feature/still-open"],
      deleteStatus: (id) => (id === "br-240-html" ? 422 : 200),
    });
    const out = captureLog();
    const code = await clean(sweepEnv(), { fetch: apis.fetch, log: out.log });
    assert.equal(code, 1);
    assert.deepEqual(deleted(apis.requests).sort(), [
      "br-240",
      "br-240-html",
      "br-chore",
    ]);
    assert.match(out.text(), /preview\/240-multipart-html-email/);
    assert.match(out.text(), /422/);
    assertNothingSecretPrinted(out.text());
  });

  it("deletes nothing and fails when Neon's branch list cannot be read", async () => {
    const apis = fakeApis({ listStatus: 401 });
    const out = captureLog();
    const code = await clean(sweepEnv(), { fetch: apis.fetch, log: out.log });
    assert.equal(code, 1);
    assert.deepEqual(deleted(apis.requests), []);
    assert.match(out.text(), /401/);
    assertNothingSecretPrinted(out.text());
  });

  it("deletes nothing and fails when Neon's answer is not a branch list", async () => {
    const apis = fakeApis({ listBody: { branches: [{ id: 7 }] } });
    const code = await clean(sweepEnv(), { fetch: apis.fetch, log: () => {} });
    assert.equal(code, 1);
    assert.deepEqual(deleted(apis.requests), []);
  });

  it("deletes nothing and fails when the open pull requests cannot be read", async () => {
    const apis = fakeApis({ pullsStatus: 403 });
    const out = captureLog();
    const code = await clean(sweepEnv(), { fetch: apis.fetch, log: out.log });
    assert.equal(code, 1);
    assert.deepEqual(deleted(apis.requests), []);
    assertNothingSecretPrinted(out.text());
  });

  it("deletes nothing when the decision is not to run", async () => {
    for (const env of [
      closeEnv({ NEON_CLEANUP_ENABLED: "false" }),
      closeEnv({ PR_HEAD_REPO: "someone/3moji" }),
      sweepEnv({ NEON_API_KEY: "" }),
    ]) {
      const apis = fakeApis();
      await clean(env, { fetch: apis.fetch, log: () => {} });
      assert.deepEqual(apis.requests, [], JSON.stringify(env));
    }
  });
});

describe("the command line", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neon-preview-cleanup-test-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const run = (env, name) => {
    const output = path.join(dir, `${name}.out`);
    const result = spawnSync(process.execPath, [script, "decide"], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env },
      encoding: "utf8",
    });
    let written = "";
    try {
      written = readFileSync(output, "utf8");
    } catch {
      // Nothing written.
    }
    return { ...result, written };
  };

  it("decide: a notice, proceed=false and a green exit before setup", () => {
    const result = run({ EVENT_NAME: "pull_request" }, "skip");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^::notice::/m);
    assert.equal(result.written, "proceed=false\n");
  });

  it("decide: an error naming what is missing, proceed=false and a red exit once enabled", () => {
    const result = run(
      sweepEnv({ NEON_PROJECT_ID: "", NEON_API_KEY: API_KEY }),
      "fail",
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^::error::.*NEON_PROJECT_ID/m);
    assert.equal(result.written, "proceed=false\n");
    assertNothingSecretPrinted(result.stdout + result.stderr);
  });

  it("decide: proceed=true when enabled and configured", () => {
    const result = run(closeEnv(), "run");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.written, "proceed=true\n");
    assertNothingSecretPrinted(result.stdout + result.stderr);
  });
});
