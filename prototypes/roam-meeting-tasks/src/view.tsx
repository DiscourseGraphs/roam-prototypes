/* The widget's React components. Display only: graph access goes through
 * load.ts (reads) and roam.ts (writes).
 *
 * These are real components with state, mounted in their own React root
 * (see mount.ts). The roam/render version could not re-render itself, so it
 * painted checkbox changes straight into the DOM; here a toggle is ordinary
 * state, and every widget on the page hears about it. */
import React from "react";
import type { WidgetArgs } from "~/args";
import { logError, MAX_REF_HOPS } from "~/config";
import { loadWidget, readDisplayRefs } from "~/load";
import type { Block, Row } from "~/model";
import { graphName, openInSidebar, writeString } from "~/roam";
import { displayText, isDone, withDone } from "~/text";

/* ── state ─────────────────────────────────────────────────────────────── */

type Async<T> = { kind: "loading" } | { kind: "failed" } | { kind: "done"; value: T };

/* Run `load` after render, and again when `deps` change. A result that
 * arrives after the component unmounted or reloaded is dropped. */
const useAsync = <T,>(load: () => Promise<T>, what: string, deps: React.DependencyList): Async<T> => {
  const [state, setState] = React.useState<Async<T>>({ kind: "loading" });
  React.useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    load().then(
      (value) => live && setState({ kind: "done", value }),
      (error) => {
        logError(`could not ${what}`, error);
        if (live) setState({ kind: "failed" });
      },
    );
    return () => {
      live = false;
    };
    // `load` is a new closure every render; `deps` says when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
};

// A task often shows in two widgets at once (the page-level one and a
// meeting's "last meeting" slot). A toggle in one is announced to all.
const WRITTEN = "roam-meeting-tasks:written";
type Written = { uid: string; string: string };
const announce = (detail: Written): void => {
  window.dispatchEvent(new CustomEvent<Written>(WRITTEN, { detail }));
};

/* The current text of each task, and the one way to toggle a checkbox:
 * update every widget at once, write, and put the text back if the write
 * fails. `toggle` never changes identity, so unchanged rows skip rendering. */
const useTaskStrings = () => {
  const [strings, setStrings] = React.useState<Record<string, string>>({});
  const latest = React.useRef(strings);
  latest.current = strings;
  React.useEffect(() => {
    const onWritten = (e: Event) => {
      const { uid, string } = (e as CustomEvent<Written>).detail;
      setStrings((prev) => ({ ...prev, [uid]: string }));
    };
    window.addEventListener(WRITTEN, onWritten);
    return () => window.removeEventListener(WRITTEN, onWritten);
  }, []);
  const current = React.useCallback((task: Block) => strings[task.uid] ?? task.string, [strings]);
  const toggle = React.useCallback((task: Block, done: boolean) => {
    const before = latest.current[task.uid] ?? task.string;
    const next = withDone(before, done);
    if (next === before) return;
    announce({ uid: task.uid, string: next });
    writeString(task.uid, next).catch((error) => {
      logError("could not save the checkbox", error);
      announce({ uid: task.uid, string: before });
    });
  }, []);
  return { current, toggle };
};

/* ── rows ──────────────────────────────────────────────────────────────── */

const dateLabel = (time: number): string =>
  new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/* A link to a block. A plain click follows it like any Roam link; shift-click
 * opens the block in the right sidebar, as it does everywhere else in Roam. */
const BlockLink = ({ uid, className, children }: { uid: string; className: string; children: React.ReactNode }) => (
  <a
    className={className}
    href={`#/app/${graphName()}/page/${uid}`}
    title="click to open · shift-click to open in the right sidebar"
    onClick={(e) => {
      // On a plain link the browser would turn shift-click into a new window,
      // so the default is cancelled first.
      if (!e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      openInSidebar(uid).catch((error) => logError("could not open the sidebar", error));
    }}
  >
    {children}
  </a>
);

type RowProps = { row: Row; string: string; text: string; toggle: (task: Block, done: boolean) => void };

const TaskRow = React.memo(({ row, string, text, toggle }: RowProps) => {
  const done = isDone(string);
  return (
    <div className="rmt-row" data-done={done ? "true" : "false"}>
      <input
        type="checkbox"
        className="rmt-check"
        checked={done}
        onChange={(e) => toggle(row.task, e.target.checked)}
      />
      {row.meeting ? (
        <span className="rmt-date">{dateLabel(row.meeting.time)}</span>
      ) : (
        <span className="rmt-date" data-inbox="true">
          inbox
        </span>
      )}
      <BlockLink uid={row.task.uid} className="rmt-text">
        {text}
      </BlockLink>
    </div>
  );
});

type RowsProps = {
  rows: Row[];
  refs: Map<string, Block>;
  tasks: ReturnType<typeof useTaskStrings>;
};

const Rows = ({ rows, refs, tasks }: RowsProps) => {
  // Display text depends only on the loaded data, not on checkbox state.
  const texts = React.useMemo(
    () => rows.map((r) => displayText(r.shown, (u) => refs.get(u)?.string, MAX_REF_HOPS)),
    [rows, refs],
  );
  return (
    <>
      {rows.map((row, i) => (
        <TaskRow
          key={row.task.uid}
          row={row}
          string={tasks.current(row.task)}
          text={texts[i]}
          toggle={tasks.toggle}
        />
      ))}
    </>
  );
};

/* The collapsed section. Its rows, and the refs inside them, are only read
 * and rendered once someone opens it. */
const LazyRows = ({ rows, tasks }: Omit<RowsProps, "refs">) => {
  const refs = useAsync(() => readDisplayRefs(rows.map((r) => r.shown)), "read block references", [rows]);
  if (refs.kind === "loading") return <div className="rmt-muted">…</div>;
  return <Rows rows={rows} refs={refs.kind === "done" ? refs.value : new Map()} tasks={tasks} />;
};

/* ── the widget ────────────────────────────────────────────────────────── */

export const MeetingTasks = ({ args }: { args: WidgetArgs }) => {
  const state = useAsync(() => loadWidget(args), "load", [args]);
  const [open, setOpen] = React.useState(false);
  const tasks = useTaskStrings();

  if (state.kind === "loading") return <div className="rmt-muted">Loading tasks…</div>;
  if (state.kind === "failed")
    return args.debug ? <div className="rmt-debug">meeting-tasks: failed to load (see console)</div> : null;
  const loaded = state.value;
  if (loaded.kind === "empty")
    return args.debug ? (
      <div className="rmt-debug">
        meeting-tasks: {loaded.reason} load={loaded.ms}ms
      </div>
    ) : null;

  const { view, refs } = loaded;
  const openCount = view.primary
    .concat(view.secondary)
    .filter((r) => !isDone(tasks.current(r.task))).length;

  return (
    <div className="rmt">
      <div className="rmt-count">
        {openCount} {openCount === 1 ? "open item" : "open items"}
      </div>
      {view.primary.length > 0 && (
        <>
          <div className="rmt-heading">
            {view.primaryLabel}
            {view.lastMeeting && (
              <>
                {" · "}
                <BlockLink uid={view.lastMeeting.uid} className="rmt-meeting">
                  {view.lastMeeting.title}
                </BlockLink>
              </>
            )}
          </div>
          <div data-section="primary">
            <Rows rows={view.primary} refs={refs} tasks={tasks} />
          </div>
        </>
      )}
      {view.secondary.length > 0 && (
        <>
          {/* Collapsed by default: on a long-lived page this section is dozens
              of items, which would bury the carried-over next actions. */}
          <div className="rmt-heading rmt-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "▾" : "▸"} {view.secondary.length} {view.secondaryLabel}
          </div>
          {open && (
            <div data-section="secondary">
              <LazyRows rows={view.secondary} tasks={tasks} />
            </div>
          )}
        </>
      )}
      {view.olderCount > 0 && (
        <div className="rmt-footer">
          window {args.lookbackDays}d · {view.olderCount}{" "}
          {view.olderCount === 1 ? "older meeting" : "older meetings"} not shown
        </div>
      )}
      {args.debug && (
        <div className="rmt-debug">
          {view.debug} load={loaded.ms}ms
        </div>
      )}
    </div>
  );
};
