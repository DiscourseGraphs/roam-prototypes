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
import { forgetReads, graphName, openInSidebar, setTaskDone } from "~/roam";
import { displayText, isDone } from "~/text";

/* ── state ─────────────────────────────────────────────────────────────── */

type Async<T> = { kind: "loading" } | { kind: "failed" } | { kind: "done"; value: T; refreshing: boolean };

/* Run `load` after render, and again when `deps` change. A result that
 * arrives after the component unmounted or reloaded is dropped. */
const useAsync = <T,>(load: () => Promise<T>, what: string, deps: React.DependencyList): Async<T> => {
  const [state, setState] = React.useState<Async<T>>({ kind: "loading" });
  React.useEffect(() => {
    let live = true;
    setState((prev) => prev.kind === "done" ? { ...prev, refreshing: true } : { kind: "loading" });
    load().then(
      (value) => live && setState({ kind: "done", value, refreshing: false }),
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

// All roots share the read generation and the pending target UIDs, including
// widgets mounted while a write is in flight.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const notify = () => listeners.forEach((listener) => listener());
let generation = 0;
const getGeneration = () => generation;
const refresh = () => {
  forgetReads();
  generation++;
  notify();
};

let pending = new Set<string>();
const getPending = () => pending;
const useTaskWrites = () => {
  const saving = React.useSyncExternalStore(subscribe, getPending);
  const [error, setError] = React.useState("");
  const toggle = React.useCallback(async (task: Block, done: boolean) => {
    if (pending.has(task.uid)) return;
    pending = new Set(pending).add(task.uid);
    notify();
    setError("");
    try {
      await setTaskDone(task.uid, done);
      refresh();
    } catch (cause) {
      logError("could not save the checkbox", cause);
      setError("Could not save the checkbox. Try again or reload the tasks.");
    } finally {
      pending = new Set(pending);
      pending.delete(task.uid);
      notify();
    }
  }, []);
  return { saving, toggle, error, clearError: () => setError("") };
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

type RowProps = { row: Row; saving: boolean; text: string; toggle: (task: Block, done: boolean) => void };

const TaskRow = React.memo(({ row, saving, text, toggle }: RowProps) => {
  const box = React.useRef<HTMLInputElement>(null);
  React.useLayoutEffect(() => {
    const input = box.current;
    const refreshButton = input?.closest(".rmt")?.querySelector<HTMLButtonElement>(".rmt-refresh");
    return () => {
      if (input && document.activeElement === input) refreshButton?.focus();
    };
  }, []);
  const done = isDone(row.task.string);
  return (
    <div className="rmt-row" data-done={done ? "true" : "false"}>
      <input
        type="checkbox"
        className="rmt-check"
        checked={done}
        ref={box}
        aria-disabled={saving || undefined}
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
  tasks: ReturnType<typeof useTaskWrites>;
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
          saving={tasks.saving.has(row.task.uid)}
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
  if (refs.kind === "failed") return <div role="alert">Could not load task references. Reload to retry.</div>;
  return <Rows rows={rows} refs={refs.value} tasks={tasks} />;
};

/* ── the widget ────────────────────────────────────────────────────────── */

export const MeetingTasks = ({ args }: { args: WidgetArgs }) => {
  const revision = React.useSyncExternalStore(subscribe, getGeneration);
  const state = useAsync(async () => ({ result: await loadWidget(args), revision }), "load", [args, revision]);
  const [request, setRequest] = React.useState<number | null>(null);
  const updated = request !== null && state.kind === "done" && !state.refreshing && state.value.revision >= request;
  React.useEffect(() => {
    if (!updated) return;
    const timer = window.setTimeout(() => setRequest(null), 2100);
    return () => window.clearTimeout(timer);
  }, [updated, request]);
  React.useEffect(() => {
    if (state.kind === "failed") setRequest(null);
  }, [state.kind]);
  const [open, setOpen] = React.useState(false);
  const tasks = useTaskWrites();
  const reload = () => {
    tasks.clearError();
    setRequest(generation + 1);
    refresh();
  };
  return (
    <div className="rmt" aria-busy={state.kind === "loading" || (state.kind === "done" && state.refreshing)}>
      <button className="rmt-refresh" type="button" data-feedback={request !== null || undefined} aria-label="Reload tasks" title={updated ? "Updated just now" : "Reload tasks"} onClick={reload}>
        <span className={`bp3-icon ${updated ? "bp3-icon-tick" : "bp3-icon-refresh"}`} aria-hidden="true" />
      </button>
      <span className="rmt-sr" role="status">{request === null ? "" : updated ? "Updated just now" : "Checking tasks"}</span>
      {tasks.error && <div role="alert">{tasks.error}</div>}
      {state.kind === "loading" && <div className="rmt-muted">Loading tasks…</div>}
      {state.kind === "failed" && <div role="alert">Could not load tasks. Reload to retry.</div>}
      {state.kind === "done" && (state.value.result.kind === "empty" ? (
        <div>No tasks to show.
          {args.debug && <div className="rmt-debug">{state.value.result.reason} load={state.value.result.ms}ms</div>}
        </div>
      ) : (
        <TaskList loaded={state.value.result} args={args} open={open} setOpen={setOpen} tasks={tasks} />
      ))}
    </div>
  );
};

const TaskList = ({ loaded, args, open, setOpen, tasks }: {
  loaded: Extract<Awaited<ReturnType<typeof loadWidget>>, { kind: "view" }>;
  args: WidgetArgs;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tasks: ReturnType<typeof useTaskWrites>;
}) => {
  const { view, refs } = loaded;
  const [showHint, setShowHint] = React.useState(false);
  const hintId = React.useId();
  const hint = `${args.lookbackDays}-day window · ${view.olderCount} older ${view.olderCount === 1 ? "meeting" : "meetings"} hidden`;
  const info = view.olderCount > 0 && (
    <span className="rmt-info" onMouseEnter={() => setShowHint(true)} onMouseLeave={() => setShowHint(false)}>
      <button type="button" aria-label="Meeting lookback details" aria-describedby={showHint ? hintId : undefined}
        onFocus={() => setShowHint(true)} onBlur={() => setShowHint(false)} onClick={() => setShowHint(true)}
        onKeyDown={(e) => { if (e.key === "Escape") setShowHint(false); }}>
        <span className="bp3-icon bp3-icon-info-sign" aria-hidden="true" />
      </button>
      {showHint && <span className="rmt-tip" id={hintId} role="tooltip">{hint}</span>}
    </span>
  );
  const openCount = view.primary
    .concat(view.secondary)
    .filter((r) => !isDone(r.task.string)).length;

  return (
    <>
      <div className={`rmt-count${view.lastMeeting ? " rmt-sr" : ""}`}>
        {openCount} {openCount === 1 ? "open item" : "open items"}
      </div>
      {(view.primary.length > 0 || view.lastMeeting) && (
        <>
          <div className="rmt-heading">
            {view.lastMeeting ? (
              <>
                <span className="bp3-icon bp3-icon-link" aria-hidden="true" /> From{" "}
                <BlockLink uid={view.lastMeeting.uid} className="rmt-meeting">
                  {view.lastMeeting.title}
                </BlockLink>
              </>
            ) : view.primaryLabel}
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
          <div className="rmt-disclosure">
            <button type="button" className="rmt-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "▾" : "▸"} {view.secondary.length} {view.secondaryLabel}
            </button>
            {info}
          </div>
          {open && (
            <div data-section="secondary">
              <LazyRows rows={view.secondary} tasks={tasks} />
            </div>
          )}
        </>
      )}
      {!view.secondary.length && info}
      {args.debug && (
        <div className="rmt-debug">
          {view.debug} load={loaded.ms}ms
        </div>
      )}
    </>
  );
};
