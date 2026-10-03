import type { Action } from "./action";
import type { Fixture, Step, TestCase } from "./kit";

// Fixtures and baseline smoke cases as machine steps, for a live rehearsal and
// the in-Roam runner alike.

const wrapCheckApply = (
  fixture: Fixture,
  check: string | null,
  apply: string,
): string => {
  const label = JSON.stringify(
    `Fixture ${fixture.id} did not take: ${fixture.why}`,
  );
  if (!check) {
    return `(async () => { await (${apply}); return "applied"; })()`;
  }
  return `(async () => {
  const present = async () => Boolean(await (${check}));
  if (await present()) return "kept";
  await (${apply});
  if (!(await present())) throw new Error(${label});
  return "applied";
})()`;
};

const assertStep = (check: string, label: string): string =>
  `(async () => { if (!(await (${check}))) throw new Error(${JSON.stringify(label)}); })()`;

// In-session fixtures become ordinary steps: a js fixture is one step that
// checks, applies and checks again; a UI fixture runs its steps every time,
// then asserts its check. Strings stay unfilled until they run.
export const inSessionSteps = (fixtures: Fixture[]): Step[] => {
  const steps: Step[] = [];
  for (const fixture of fixtures.filter(
    (item) => item.phase === "in-session",
  )) {
    const check =
      fixture.check && "js" in fixture.check ? fixture.check.js : null;
    if ("js" in fixture.apply) {
      steps.push({
        id: `fixture-${fixture.id}`,
        do: { js: wrapCheckApply(fixture, check, fixture.apply.js) },
        why: fixture.why,
        source: "kit",
      });
      continue;
    }
    if ("steps" in fixture.apply) {
      fixture.apply.steps.forEach((step, index) => {
        steps.push({
          ...step,
          id: `fixture-${fixture.id}-${index + 1}`,
          source: "kit",
        });
      });
      if (check) {
        steps.push({
          id: `fixture-${fixture.id}-check`,
          do: {
            js: assertStep(
              check,
              `Fixture ${fixture.id} did not take: ${fixture.why}`,
            ),
          },
          why: `confirm ${fixture.why}`,
          source: "kit",
        });
      }
    }
  }
  return steps;
};

export const assertCase = (js: string, label: string): Action => ({
  js: `(async () => {
  try {
    await (${js});
  } catch (error) {
    throw new Error(${JSON.stringify(label)} + ": " + (error && error.message ? error.message : String(error)));
  }
})()`,
});

// Smoke cases are always-true checks from the baseline. They run as setup
// steps, so a broken environment fails fast and never reaches a PR case.
// Smoke checks that need your eyes (text only) can't run unattended.
export const smokeSteps = (smoke: TestCase[]): Step[] => {
  const steps: Step[] = [];
  for (const testCase of smoke) {
    if (testCase.steps.length === 0 && !testCase.expect?.js) continue;
    testCase.steps.forEach((step, index) => {
      steps.push({
        ...step,
        id: `smoke-${testCase.id}-${index + 1}`,
        source: "kit",
      });
    });
    if (testCase.expect?.js) {
      steps.push({
        id: `smoke-${testCase.id}-check`,
        do: assertCase(
          testCase.expect.js,
          `Smoke check failed: ${testCase.title}`,
        ),
        why: `smoke: ${testCase.title}`,
        source: "kit",
      });
    }
  }
  return steps;
};
