import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getAuthTables } from "better-auth/db";

import { authSchema } from "./schema";

/**
 * Better Auth's Drizzle adapter looks a table up by its model name and then
 * addresses columns by the Drizzle **property** key, resolved through its own
 * `getFieldName`. So a missing or misnamed property is a runtime failure in
 * production, not a type error at build time. These tests compare our schema
 * against Better Auth's own runtime description of what it needs, so a version
 * bump that adds a column fails here instead of in production.
 */
const required = getAuthTables({ emailAndPassword: { enabled: true } });
const specByModel = new Map(
  Object.values(required).map((table) => [table.modelName, table] as const),
);

/**
 * The facts this suite checks about a column. Annotating the lookup keeps
 * dynamic indexing type-safe without an assertion, which the package's lint
 * rules forbid.
 */
interface ColumnFacts {
  readonly notNull: boolean;
  readonly isUnique: boolean;
}

/** A guard clause rather than an assertion: the failure names what is missing. */
function specFor(modelName: string) {
  const spec = specByModel.get(modelName);
  if (spec === undefined) {
    throw new Error(
      `Better Auth does not describe a "${modelName}" model. Expected one of: ${[...specByModel.keys()].join(", ")}.`,
    );
  }
  return spec;
}

describe("authSchema satisfies Better Auth", () => {
  it("declares every model Better Auth expects, and no others", () => {
    expect(Object.keys(authSchema).sort()).toEqual(
      [...specByModel.keys()].sort(),
    );
  });

  describe.each(Object.entries(authSchema))("%s", (modelName, table) => {
    it("is named in the database the way Better Auth names the model", () => {
      expect(getTableName(table)).toBe(modelName);
    });

    it("has an id column, which Better Auth assumes implicitly", () => {
      expect(Object.keys(getTableColumns(table))).toContain("id");
    });

    it("has a property for every field Better Auth addresses", () => {
      expect(Object.keys(getTableColumns(table))).toEqual(
        expect.arrayContaining(Object.keys(specFor(modelName).fields)),
      );
    });

    it("marks Better Auth's required fields as not-null", () => {
      const columns: Record<string, ColumnFacts | undefined> =
        getTableColumns(table);
      const nullable = Object.entries(specFor(modelName).fields)
        .filter(([, field]) => field.required === true)
        .map(([name]) => name)
        .filter((name) => columns[name]?.notNull !== true);

      expect(nullable).toEqual([]);
    });

    it("marks Better Auth's unique fields as unique", () => {
      const columns: Record<string, ColumnFacts | undefined> =
        getTableColumns(table);
      const notUnique = Object.entries(specFor(modelName).fields)
        .filter(([, field]) => field.unique === true)
        .map(([name]) => name)
        .filter((name) => columns[name]?.isUnique !== true);

      expect(notUnique).toEqual([]);
    });

    it("declares a cascading foreign key for every reference Better Auth states", () => {
      const referencing = Object.values(specFor(modelName).fields).filter(
        (field) => field.references !== undefined,
      );
      const { foreignKeys } = getTableConfig(table);

      expect(foreignKeys).toHaveLength(referencing.length);
      for (const foreignKey of foreignKeys) {
        // Better Auth states onDelete: "cascade" for both user references.
        // Losing that would orphan sessions and accounts behind a deleted user,
        // which ADR-0004's account-deletion rule depends on.
        expect(foreignKey.onDelete).toBe("cascade");

        // Resolve the reference rather than trusting its presence: this is what
        // proves the key points at user.id and not merely somewhere.
        const reference = foreignKey.reference();
        expect(getTableName(reference.foreignTable)).toBe("user");
        expect(reference.foreignColumns.map((column) => column.name)).toEqual([
          "id",
        ]);
      }
    });
  });
});
