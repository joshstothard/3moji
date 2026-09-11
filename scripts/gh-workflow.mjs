#!/usr/bin/env node
// gh-workflow.mjs: the one place the workflow skills talk to GitHub Issues and
// GitHub Projects. Skills call these subcommands instead of hand-writing
// GraphQL, so the tracker plumbing lives in one tested file rather than being
// copied (and drifting) across a dozen SKILL.md files.
//
// Requires the GitHub CLI, authenticated with the `project` scope:
//   gh auth login && gh auth refresh -s project
//
// Usage:
//   node scripts/gh-workflow.mjs doctor
//   node scripts/gh-workflow.mjs setup [--title "<board title>"]
//   node scripts/gh-workflow.mjs project
//   node scripts/gh-workflow.mjs issue <number>
//   node scripts/gh-workflow.mjs status <issue-or-pr-number> "<Backlog|In Progress|In Review|Done>"
//   node scripts/gh-workflow.mjs sub-issue <parent-number> <child-number>
//   node scripts/gh-workflow.mjs epic-sync <issue-number>
//
// The board is discovered automatically: the open GitHub Project linked to this
// repository. Set GH_PROJECT_OWNER and GH_PROJECT_NUMBER (in the environment or
// in .env) to override.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const STATUSES = ["Backlog", "In Progress", "In Review", "Done"];

// Status options the board is set up with. A board created by hand (or by an
// older gh) may still have GitHub's defaults, so each status also lists the
// names it falls back to.
const STATUS_OPTIONS = {
  Backlog: {
    color: "GRAY",
    description: "Filed, not started",
    aliases: ["backlog", "todo"],
  },
  "In Progress": {
    color: "YELLOW",
    description: "Assigned and being built",
    aliases: ["in progress"],
  },
  "In Review": {
    color: "BLUE",
    description: "PR open, awaiting review or CI",
    aliases: ["in review", "in progress"],
  },
  Done: {
    color: "GREEN",
    description: "PR merged, issue closed",
    aliases: ["done"],
  },
};

const LABELS = [
  ["epic", "5319e7", "Parent issue grouping a workstream phase"],
  ["task", "c5def5", "A unit of work that is neither a bug nor a feature"],
  ["bug", "d73a4a", "Something isn't working"],
  ["enhancement", "a2eeef", "New feature or request"],
];

const normalise = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");

function fail(message) {
  process.stderr.write(`gh-workflow: ${message}\n`);
  process.exit(1);
}

function gh(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      fail(
        "the GitHub CLI (gh) is not installed. Install it (e.g. `brew install gh`) and run `gh auth login`.",
      );
    }
    fail(result.error.message);
  }
  if (result.status !== 0 && !allowFailure) {
    fail(`gh ${args.join(" ")} failed:\n${result.stderr.trim()}`);
  }
  return result;
}

function graphql(query, variables = {}) {
  // gh exits non-zero when the response carries GraphQL errors, but still
  // prints the body, so parse it first to surface GitHub's own message.
  const { stdout, stderr, status } = gh(
    ["api", "graphql", "-H", "GraphQL-Features: sub_issues", "--input", "-"],
    { input: JSON.stringify({ query, variables }), allowFailure: true },
  );
  let body;
  try {
    body = JSON.parse(stdout);
  } catch {
    fail(`gh api graphql failed:\n${stderr.trim() || stdout.trim()}`);
  }
  if (body.errors?.length) {
    fail(
      `GitHub API error: ${body.errors.map((error) => error.message).join("; ")}`,
    );
  }
  if (status !== 0) fail(`gh api graphql failed:\n${stderr.trim()}`);
  return body.data;
}

function repo() {
  const { stdout } = gh(["repo", "view", "--json", "nameWithOwner,owner,name"]);
  const data = JSON.parse(stdout);
  return { owner: data.owner.login, name: data.name, full: data.nameWithOwner };
}

function toNumber(value, label) {
  const number = Number.parseInt(String(value ?? "").replace(/^#/, ""), 10);
  if (!Number.isInteger(number) || number <= 0) {
    fail(`${label} must be an issue or PR number (got "${value ?? ""}")`);
  }
  return number;
}

const PROJECT_FIELDS = `
  id number title url closed
  field(name: "Status") {
    ... on ProjectV2SingleSelectField { id options { id name } }
  }
`;

// Find the board for this repo. Returns null when none is linked.
function findProject({ quiet = false } = {}) {
  const { owner, name } = repo();
  const envOwner = process.env.GH_PROJECT_OWNER;
  const envNumber = process.env.GH_PROJECT_NUMBER;
  if (envOwner && envNumber) {
    const number = toNumber(envNumber, "GH_PROJECT_NUMBER");
    const data = graphql(
      `query($login: String!, $number: Int!) {
        repositoryOwner(login: $login) {
          ... on ProjectV2Owner { projectV2(number: $number) { ${PROJECT_FIELDS} } }
        }
      }`,
      { login: envOwner, number },
    );
    const project = data.repositoryOwner?.projectV2;
    if (!project) fail(`no project ${envOwner}/${number} found`);
    return { ...project, owner: envOwner };
  }
  const data = graphql(
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        projectsV2(first: 20) {
          nodes {
            ${PROJECT_FIELDS}
            owner { ... on User { login } ... on Organization { login } }
          }
        }
      }
    }`,
    { owner, name },
  );
  const open = data.repository.projectsV2.nodes.filter((p) => !p.closed);
  if (open.length === 0) return null;
  const chosen = open.find((p) => p.title === name) ?? open[0];
  if (open.length > 1 && !quiet) {
    process.stderr.write(
      `gh-workflow: ${open.length} boards are linked to ${owner}/${name}; using "${chosen.title}". Set GH_PROJECT_OWNER/GH_PROJECT_NUMBER to choose another.\n`,
    );
  }
  return { ...chosen, owner: chosen.owner.login };
}

function requireProject() {
  const project = findProject();
  if (!project) {
    fail(
      "no GitHub Project board is linked to this repository. Run `node scripts/gh-workflow.mjs setup` once.",
    );
  }
  if (!project.field) {
    fail(`board "${project.title}" has no single-select Status field`);
  }
  return project;
}

export function resolveOption(options, status) {
  const spec = STATUS_OPTIONS[status];
  if (!spec) return null;
  for (const alias of spec.aliases) {
    const match = options.find((option) => normalise(option.name) === alias);
    if (match) return match;
  }
  return null;
}

function canonicalStatus(input) {
  const wanted = normalise(input ?? "");
  const status = STATUSES.find((s) => normalise(s) === wanted);
  if (!status) {
    fail(
      `status must be one of: ${STATUSES.map((s) => `"${s}"`).join(", ")} (got "${input ?? ""}")`,
    );
  }
  return status;
}

// Build the option list for updateProjectV2Field: the four workflow statuses in
// order, reusing existing option ids so items already on the board keep their
// values, followed by any extra columns the user added themselves.
export function plannedOptions(existing) {
  const used = new Set();
  const planned = STATUSES.map((status) => {
    const spec = STATUS_OPTIONS[status];
    const match = spec.aliases
      .map((alias) =>
        existing.find(
          (option) => normalise(option.name) === alias && !used.has(option.id),
        ),
      )
      .find(Boolean);
    if (match) used.add(match.id);
    return {
      ...(match ? { id: match.id } : {}),
      name: status,
      color: spec.color,
      description: spec.description,
    };
  });
  const extras = existing
    .filter((option) => !used.has(option.id))
    .map((option) => ({
      id: option.id,
      name: option.name,
      color: "GRAY",
      description: "",
    }));
  return [...planned, ...extras];
}

function contentFor(number) {
  const { owner, name } = repo();
  const data = graphql(
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issueOrPullRequest(number: $number) {
            __typename
            ... on Issue {
              id
              url
              title
              projectItems(first: 20) {
                nodes {
                  id
                  project {
                    id
                  }
                }
              }
            }
            ... on PullRequest {
              id
              url
              title
              projectItems(first: 20) {
                nodes {
                  id
                  project {
                    id
                  }
                }
              }
            }
          }
        }
      }
    `,
    { owner, name, number },
  );
  const content = data.repository.issueOrPullRequest;
  if (!content) fail(`#${number} does not exist in ${owner}/${name}`);
  return content;
}

function commandStatus([numberArg, statusArg]) {
  setStatus(toNumber(numberArg, "status"), canonicalStatus(statusArg));
}

function setStatus(number, status, project = requireProject()) {
  const option = resolveOption(project.field.options, status);
  if (!option) {
    fail(
      `board "${project.title}" has no Status option for "${status}". Run \`node scripts/gh-workflow.mjs setup\` to add the workflow statuses.`,
    );
  }
  const content = contentFor(number);
  let item = content.projectItems.nodes.find(
    (node) => node.project.id === project.id,
  );
  if (!item) {
    item = graphql(
      `
        mutation ($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(
            input: { projectId: $projectId, contentId: $contentId }
          ) {
            item {
              id
            }
          }
        }
      `,
      { projectId: project.id, contentId: content.id },
    ).addProjectV2ItemById.item;
  }
  graphql(
    `
      mutation (
        $projectId: ID!
        $itemId: ID!
        $fieldId: ID!
        $optionId: String!
      ) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `,
    {
      projectId: project.id,
      itemId: item.id,
      fieldId: project.field.id,
      optionId: option.id,
    },
  );
  const note =
    normalise(option.name) === normalise(status)
      ? ""
      : ` (board column "${option.name}")`;
  console.log(`#${number} → ${status}${note} on "${project.title}"`);
}

function commandIssue([numberArg]) {
  const number = toNumber(numberArg, "issue");
  const { owner, name } = repo();
  const data = graphql(
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        viewer {
          login
        }
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            number
            title
            url
            state
            stateReason
            body
            createdAt
            author {
              login
            }
            assignees(first: 10) {
              nodes {
                login
              }
            }
            labels(first: 20) {
              nodes {
                name
              }
            }
            milestone {
              title
            }
            parent {
              number
              title
              url
              state
              parent {
                number
                title
                url
                state
              }
            }
            subIssues(first: 50) {
              nodes {
                number
                title
                url
                state
                assignees(first: 5) {
                  nodes {
                    login
                  }
                }
              }
            }
            comments(last: 50) {
              nodes {
                author {
                  login
                }
                body
                createdAt
                url
              }
            }
            closedByPullRequestsReferences(first: 20, includeClosedPrs: true) {
              nodes {
                number
                title
                url
                state
              }
            }
            projectItems(first: 10) {
              nodes {
                project {
                  title
                  number
                }
                fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                  }
                }
              }
            }
          }
        }
      }
    `,
    { owner, name, number },
  );
  const issue = data.repository.issue;
  if (!issue) {
    fail(
      `#${number} is not an issue in ${owner}/${name} (it may be a pull request)`,
    );
  }
  const flat = {
    viewer: data.viewer.login,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateReason: issue.stateReason,
    author: issue.author?.login ?? null,
    createdAt: issue.createdAt,
    assignees: issue.assignees.nodes.map((node) => node.login),
    labels: issue.labels.nodes.map((node) => node.name),
    milestone: issue.milestone?.title ?? null,
    boardStatus: issue.projectItems.nodes.map((node) => ({
      board: node.project.title,
      status: node.fieldValueByName?.name ?? null,
    })),
    parent: issue.parent,
    subIssues: issue.subIssues.nodes.map((node) => ({
      number: node.number,
      title: node.title,
      url: node.url,
      state: node.state,
      assignees: node.assignees.nodes.map((a) => a.login),
    })),
    linkedPullRequests: issue.closedByPullRequestsReferences.nodes,
    body: issue.body,
    comments: issue.comments.nodes.map((node) => ({
      author: node.author?.login ?? null,
      createdAt: node.createdAt,
      url: node.url,
      body: node.body,
    })),
  };
  console.log(JSON.stringify(flat, null, 2));
}

function commandSubIssue([parentArg, childArg]) {
  const parent = toNumber(parentArg, "parent");
  const child = toNumber(childArg, "child");
  const { owner, name } = repo();
  const ids = graphql(
    `
      query ($owner: String!, $name: String!, $parent: Int!, $child: Int!) {
        repository(owner: $owner, name: $name) {
          parent: issue(number: $parent) {
            id
            title
          }
          child: issue(number: $child) {
            id
            title
            parent {
              number
            }
          }
        }
      }
    `,
    { owner, name, parent, child },
  ).repository;
  if (!ids.parent) fail(`#${parent} is not an issue`);
  if (!ids.child) fail(`#${child} is not an issue`);
  if (ids.child.parent?.number === parent) {
    console.log(`#${child} is already a sub-issue of #${parent}`);
    return;
  }
  if (ids.child.parent) {
    fail(
      `#${child} already belongs to #${ids.child.parent.number}; remove it there first if it should move`,
    );
  }
  graphql(
    `
      mutation ($issueId: ID!, $subIssueId: ID!) {
        addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
          issue {
            number
          }
        }
      }
    `,
    { issueId: ids.parent.id, subIssueId: ids.child.id },
  );
  console.log(
    `#${child} is now a sub-issue of #${parent} (${ids.parent.title})`,
  );
}

// Keep an epic's board card in step with its sub-issues: once any work starts it
// moves out of Backlog, and when every sub-issue is closed the epic is closed
// and marked Done. Safe to run repeatedly.
function commandEpicSync([numberArg]) {
  const number = toNumber(numberArg, "epic-sync");
  const { owner, name } = repo();
  const data = graphql(
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            number
            labels(first: 20) {
              nodes {
                name
              }
            }
            parent {
              number
              title
              state
              labels(first: 20) {
                nodes {
                  name
                }
              }
              subIssues(first: 100) {
                totalCount
                nodes {
                  number
                  state
                }
              }
              projectItems(first: 10) {
                nodes {
                  project {
                    id
                  }
                  fieldValueByName(name: "Status") {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    { owner, name, number },
  );
  const issue = data.repository.issue;
  if (!issue) fail(`#${number} is not an issue`);
  const isEpic = (node) => node.labels.nodes.some((l) => l.name === "epic");
  // Accept the epic itself as well as one of its sub-issues.
  let epic = issue.parent;
  if (isEpic(issue)) {
    epic = graphql(
      `
        query ($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            issue(number: $number) {
              number
              title
              state
              labels(first: 20) {
                nodes {
                  name
                }
              }
              subIssues(first: 100) {
                totalCount
                nodes {
                  number
                  state
                }
              }
              projectItems(first: 10) {
                nodes {
                  project {
                    id
                  }
                  fieldValueByName(name: "Status") {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { owner, name, number },
    ).repository.issue;
  }
  if (!epic || !isEpic(epic)) {
    console.log(`#${number} has no parent epic; nothing to sync`);
    return;
  }
  const project = requireProject();
  const current =
    epic.projectItems.nodes.find((node) => node.project.id === project.id)
      ?.fieldValueByName?.name ?? null;
  const subs = epic.subIssues.nodes;
  const closed = subs.filter((sub) => sub.state === "CLOSED").length;
  const allClosed =
    subs.length > 0 &&
    closed === subs.length &&
    epic.subIssues.totalCount === subs.length;

  if (allClosed) {
    if (epic.state === "OPEN") {
      gh([
        "issue",
        "close",
        String(epic.number),
        "--comment",
        `All ${subs.length} sub-issues are closed.`,
      ]);
      console.log(`Closed epic #${epic.number} (${epic.title})`);
    }
    setStatus(epic.number, "Done", project);
    return;
  }
  const inBacklog =
    current === null || ["backlog", "todo"].includes(normalise(current));
  if (inBacklog && epic.state === "OPEN") {
    setStatus(epic.number, "In Progress", project);
  } else {
    console.log(
      `Epic #${epic.number}: ${closed}/${subs.length} sub-issues closed; status "${current}" unchanged`,
    );
  }
}

function commandProject() {
  const project = findProject();
  console.log(
    JSON.stringify(
      project
        ? {
            owner: project.owner,
            number: project.number,
            title: project.title,
            url: project.url,
            statuses: project.field?.options.map((option) => option.name) ?? [],
          }
        : null,
      null,
      2,
    ),
  );
}

function scopes() {
  const { stdout, stderr } = gh(["auth", "status"], { allowFailure: true });
  const text = `${stdout}\n${stderr}`;
  const line = text.split("\n").find((l) => /Token scopes:/i.test(l)) ?? "";
  return {
    loggedIn: /Logged in to github\.com/i.test(text),
    // null when gh does not list scopes (GH_TOKEN or a fine-grained token):
    // the scope is then unknown rather than missing.
    scopes: line ? [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]) : null,
  };
}

function commandSetup(args) {
  const titleIndex = args.indexOf("--title");
  const { owner, name, full } = repo();
  const title = titleIndex !== -1 ? args[titleIndex + 1] : name;
  if (!title) fail("--title needs a value");
  const auth = scopes();
  if (auth.scopes && !auth.scopes.includes("project")) {
    fail("gh is missing the `project` scope. Run: gh auth refresh -s project");
  }

  let project = findProject({ quiet: true });
  if (project) {
    console.log(`Board already linked: "${project.title}" (${project.url})`);
  } else {
    const created = JSON.parse(
      gh([
        "project",
        "create",
        "--owner",
        owner,
        "--title",
        title,
        "--format",
        "json",
      ]).stdout,
    );
    gh([
      "project",
      "link",
      String(created.number),
      "--owner",
      owner,
      "--repo",
      full,
    ]);
    console.log(`Created and linked board "${title}" (${created.url})`);
    project = requireProject();
  }

  if (!project.field) fail(`board "${project.title}" has no Status field`);
  const options = plannedOptions(project.field.options);
  const alreadyConfigured = STATUSES.every((status, index) => {
    const option = project.field.options[index];
    return option && normalise(option.name) === normalise(status);
  });
  if (alreadyConfigured) {
    console.log(`Status columns already set: ${STATUSES.join(" → ")}`);
  } else {
    graphql(
      `
        mutation (
          $fieldId: ID!
          $options: [ProjectV2SingleSelectFieldOptionInput!]
        ) {
          updateProjectV2Field(
            input: { fieldId: $fieldId, singleSelectOptions: $options }
          ) {
            projectV2Field {
              ... on ProjectV2SingleSelectField {
                options {
                  name
                }
              }
            }
          }
        }
      `,
      { fieldId: project.field.id, options },
    );
    console.log(
      `Status columns set: ${options.map((o) => o.name).join(" → ")}`,
    );
  }

  for (const [label, color, description] of LABELS) {
    gh([
      "label",
      "create",
      label,
      "--color",
      color,
      "--description",
      description,
      "--force",
    ]);
  }
  console.log(`Labels ready: ${LABELS.map(([label]) => label).join(", ")}`);
  console.log(
    "\nOne manual step: open the board, click the view's ▾ menu → Layout → Board, so the Status columns show as a Kanban.",
  );
}

function commandDoctor() {
  const checks = [];
  const version = spawnSync("gh", ["--version"], { encoding: "utf8" });
  checks.push([
    "GitHub CLI installed",
    !version.error,
    version.stdout?.split("\n")[0] ?? "brew install gh",
  ]);
  if (version.error) return report(checks);
  const auth = scopes();
  checks.push([
    "Logged in",
    auth.loggedIn,
    auth.loggedIn ? "" : "gh auth login",
  ]);
  const hasProjectScope =
    auth.scopes === null || auth.scopes.includes("project");
  checks.push([
    "project scope",
    hasProjectScope,
    auth.scopes === null
      ? "not listed by gh for this token; board calls will confirm it"
      : hasProjectScope
        ? ""
        : "gh auth refresh -s project",
  ]);
  if (!auth.loggedIn) return report(checks);
  const repoView = gh(["repo", "view", "--json", "nameWithOwner"], {
    allowFailure: true,
  });
  checks.push([
    "Repository on GitHub",
    repoView.status === 0,
    repoView.status === 0
      ? JSON.parse(repoView.stdout).nameWithOwner
      : "gh repo create <name> --private --source=. --remote=origin --push",
  ]);
  if (repoView.status !== 0 || !hasProjectScope) {
    return report(checks);
  }
  const project = findProject({ quiet: true });
  checks.push([
    "Board linked",
    Boolean(project),
    project ? project.url : "node scripts/gh-workflow.mjs setup",
  ]);
  if (project?.field) {
    // Exact names only: the aliases let `status` cope with a default board,
    // but a board still on Todo/In Progress/Done silently files "In Review"
    // under In Progress, so doctor treats it as not set up.
    const names = project.field.options.map((o) => normalise(o.name));
    const missing = STATUSES.filter(
      (status) => !names.includes(normalise(status)),
    );
    checks.push([
      "Status columns",
      missing.length === 0,
      missing.length
        ? `missing ${missing.join(", ")}: node scripts/gh-workflow.mjs setup`
        : project.field.options.map((o) => o.name).join(" → "),
    ]);
  }
  return report(checks);
}

function report(checks) {
  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
  }
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}

const commands = {
  doctor: commandDoctor,
  setup: commandSetup,
  project: commandProject,
  issue: commandIssue,
  status: commandStatus,
  "sub-issue": commandSubIssue,
  "epic-sync": commandEpicSync,
};

function loadDotEnv() {
  // Optional GH_PROJECT_* overrides may live in the repo's gitignored .env.
  // process.loadEnvFile needs Node 20.12+; older Nodes just skip it.
  const file = new URL("../.env", import.meta.url);
  if (fs.existsSync(file) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(fileURLToPath(file));
    } catch {
      /* a malformed .env should not stop tracker calls */
    }
  }
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (isMain) {
  loadDotEnv();
  const [command, ...rest] = process.argv.slice(2);
  const handler = commands[command];
  if (!handler) {
    fail(
      `unknown command "${command ?? ""}". Commands: ${Object.keys(commands).join(", ")}`,
    );
  }
  handler(rest);
}
