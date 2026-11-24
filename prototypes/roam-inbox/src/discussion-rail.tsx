import React from "react";
import { Button, HTMLSelect, Icon, Spinner, TextArea } from "@blueprintjs/core";
import {
  canAddComments,
  fetchDiscussions,
  setThreadResolved,
  type CommentContent,
  type DiscussionComment,
  type DiscussionContext,
  type DiscussionSnapshot,
  type DiscussionThread,
  DISCUSSIONS_CHANGED,
} from "~/discussion-data";
import { openInSidebar } from "~/roam";
import { prettify, relTime } from "~/text";

type Filter = "open" | "all" | "resolved";
type RailProps = {
  context: DiscussionContext;
  onClose: () => void;
  onSnapshot: (snapshot: DiscussionSnapshot) => void;
};

import { useDiscussionDraft } from "~/discussion-drafts";
export { clearDiscussionDrafts } from "~/discussion-drafts";

const RoamText = ({
  content,
}: {
  content: CommentContent;
}): React.ReactElement => {
  const BlockString = window.roamAlphaAPI.ui.react?.BlockString;
  return (
    <div className="rmi-discussion-content">
      {BlockString ? <BlockString string={content.string} /> : content.string}
      {content.children.length > 0 && (
        <div className="rmi-discussion-nested">
          {content.children.map((child) => (
            <RoamText key={child.uid} content={child} />
          ))}
        </div>
      )}
    </div>
  );
};

const Comment = ({
  comment,
  actions,
}: {
  comment: DiscussionComment;
  actions?: React.ReactNode;
}): React.ReactElement => (
  <div className="rmi-discussion-message">
    <div className="rmi-discussion-message-body">
      <div className="rmi-discussion-author">
        <strong>{comment.author}</strong>
        <time
          title={
            comment.time ? new Date(comment.time).toLocaleString() : undefined
          }
          dateTime={
            comment.time ? new Date(comment.time).toISOString() : undefined
          }
        >
          {comment.time ? relTime(comment.time) : "Unknown time"}
        </time>
        {actions}
      </div>
      <RoamText content={comment} />
    </div>
  </div>
);

type ComposerProps = {
  uid: string;
  isNew?: boolean;
  onPosted: () => Promise<void>;
};

const Composer = ({
  uid,
  isNew = false,
  onPosted,
}: ComposerProps): React.ReactElement => {
  const { draft, edit, submit } = useDiscussionDraft(
    uid,
    isNew ? "thread" : "reply",
  );
  const { text, posting, error } = draft;
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const post = async (): Promise<void> => {
    if (!canAddComments()) return;
    const posted = await submit();
    if (!posted) return;
    if (alive.current) await onPosted();
    else window.dispatchEvent(new Event(DISCUSSIONS_CHANGED));
  };

  return (
    <div className="rmi-discussion-composer">
      <TextArea
        fill
        rows={2}
        aria-label={isNew ? "New thread" : "Reply to thread"}
        placeholder={isNew ? "Start a discussion…" : "Write a reply…"}
        value={text}
        disabled={posting}
        onChange={(e) => edit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (
            !e.nativeEvent.isComposing &&
            (e.metaKey || e.ctrlKey) &&
            e.key === "Enter"
          ) {
            e.preventDefault();
            void post();
          }
        }}
      />
      <div className="rmi-discussion-composer-bottom">
        <span role="status">
          {posting
            ? "Posting…"
            : draft.posted
              ? "Posted"
              : text
                ? "Draft in this tab"
                : ""}
        </span>
        <Button
          intent="primary"
          small
          rightIcon="arrow-up"
          text={isNew ? "Post thread" : "Reply"}
          loading={posting}
          disabled={!text.trim() || !canAddComments()}
          onClick={() => void post()}
        />
      </div>
      {error && (
        <div className="rmi-discussion-error" role="alert">
          {error}
        </div>
      )}
      {!canAddComments() && (
        <div className="rmi-discussion-error" role="alert">
          Native comment creation is unavailable in this Roam build.
        </div>
      )}
    </div>
  );
};

type ThreadProps = {
  thread: DiscussionThread;
  expanded: boolean;
  selected: boolean;

  toggle: () => void;
  reload: () => Promise<void>;
};

const Thread = ({
  thread,
  expanded,
  selected,
  toggle,
  reload,
}: ThreadProps): React.ReactElement => {
  const [busy, setBusy] = React.useState(false);
  const updating = React.useRef(false);
  const [error, setError] = React.useState("");
  const alive = React.useRef(true);
  React.useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const resolve = async (): Promise<void> => {
    if (updating.current) return;
    updating.current = true;
    setBusy(true);
    setError("");
    try {
      await setThreadResolved({ uid: thread.uid, resolved: !thread.resolved });
      if (alive.current) await reload();
      else window.dispatchEvent(new Event(DISCUSSIONS_CHANGED));
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "Could not update this thread.",
        );
    } finally {
      updating.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const toggleLabel = expanded ? "Collapse thread" : "Expand thread";
  const resolveLabel = thread.resolved ? "Reopen" : "Resolve";
  return (
    <article
      className={`rmi-discussion-thread${selected ? " rmi-discussion-selected" : ""}`}
      data-thread-uid={thread.uid}
      data-expanded={expanded}
      tabIndex={-1}
    >
      {thread.resolved && (
        <div className="rmi-discussion-resolved">Resolved</div>
      )}
      <Comment
        comment={thread}
        actions={
          <div className="rmi-discussion-actions">
            <Button
              minimal
              small
              className="rmi-discussion-resolve"
              icon={thread.resolved ? "undo" : "tick"}
              aria-label={resolveLabel}
              data-tooltip={thread.resolved ? "Reopen thread" : "Resolve thread"}
              data-busy={busy}
              loading={busy}
              onClick={() => void resolve()}
            />
            <Button
              minimal
              small
              icon={expanded ? "chevron-up" : "chevron-down"}
              aria-label={toggleLabel}
              data-tooltip={toggleLabel}
              aria-expanded={expanded}
              onClick={toggle}
            />
          </div>
        }
      />
      {!expanded && thread.replies.length > 0 && (
        <div className="rmi-discussion-reply-count">
          {thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}
        </div>
      )}
      {expanded && (
        <div className="rmi-discussion-replies">
          {thread.replies.map((reply) => (
            <Comment key={reply.uid} comment={reply} />
          ))}
          {thread.resolved ? (
            <div className="rmi-discussion-note">
              Reopen this thread to continue the discussion.
            </div>
          ) : (
            <Composer key={thread.uid} uid={thread.uid} onPosted={reload} />
          )}
        </div>
      )}
      {error && (
        <div className="rmi-discussion-error" role="alert">
          {error}
        </div>
      )}
    </article>
  );
};

export const InlineDiscussions = ({
  threads,
  reload,
  onOpenPage,
  onClose,
}: {
  threads: DiscussionThread[];
  reload: () => Promise<void>;
  onOpenPage: () => void;
  onClose: () => void;
}): React.ReactElement => {
  const [expanded, setExpanded] = React.useState<string | undefined>(
    () => (threads.find((t) => !t.resolved) || threads[0])?.uid,
  );
  return (
    <section
      aria-label="Block discussions"
      onKeyDown={(e) => {
        if (
          e.key === "Escape" &&
          !e.defaultPrevented &&
          !e.nativeEvent.isComposing
        ) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="rmi-inline-header">
        <strong>Block discussions</strong>
        <div>
          <Button
            minimal
            small
            rightIcon="panel-stats"
            text="Page discussions"
            onClick={onOpenPage}
          />
          <Button
            minimal
            small
            icon="cross"
            aria-label="Close block discussions"
            onClick={onClose}
          />
        </div>
      </header>
      {threads.map((thread) => (
        <Thread
          key={thread.uid}
          thread={thread}
          selected={false}
          expanded={expanded === thread.uid}
          reload={reload}
          toggle={() =>
            setExpanded((current) =>
              current === thread.uid ? undefined : thread.uid,
            )
          }
        />
      ))}
    </section>
  );
};

const SourceGroup = ({
  onNavigate,
  threads,
  children,
}: {
  threads: DiscussionThread[];
  children: React.ReactNode;
  onNavigate: () => void;
}): React.ReactElement => {
  const { source } = threads[0];
  const [error, setError] = React.useState("");
  const openSource = async (): Promise<void> => {
    try {
      await openInSidebar(source.uid);
      setError("");
      onNavigate();
    } catch {
      setError("Could not open the source block.");
    }
  };
  const label = prettify(source.string, null) || "Source block";
  return (
    <section className="rmi-discussion-group" aria-label={label}>
      <h3>
        <Button
          className="rmi-discussion-source"
          minimal
          small
          rightIcon="arrow-top-right"
          text={label}
          title={`Open source in Roam’s sidebar: ${label}`}
          onClick={() => void openSource()}
        />
      </h3>
      {error && (
        <div role="alert" className="rmi-discussion-error">
          {error}
        </div>
      )}
      {children}
    </section>
  );
};

export const DiscussionRail = ({
  context,
  onClose,
  onSnapshot,
}: RailProps): React.ReactElement => {
  const [snapshot, setSnapshot] = React.useState<DiscussionSnapshot>({
    sources: [],
    threads: [],
  });
  const [filter, setFilter] = React.useState<Filter>("open");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [preferredSource, setPreferredSource] = React.useState(
    context.sourceUid,
  );
  const sourceUid = snapshot.sources.some(
    (source) => source.uid === preferredSource,
  )
    ? preferredSource
    : snapshot.sources[0]?.uid;
  const [composing, setComposing] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const alive = React.useRef(true);
  const seq = React.useRef(0);
  const reading = React.useRef(false);
  const appliedContext = React.useRef<DiscussionContext>();
  const [focusTarget, setFocusTarget] = React.useState<{ uid?: string }>();
  const snapshotHandler = React.useRef(onSnapshot);
  snapshotHandler.current = onSnapshot;

  const reload = React.useCallback(async (): Promise<void> => {
    if (!alive.current) return;
    const mine = ++seq.current;
    reading.current = true;
    setRefreshing(true);
    try {
      const next = await fetchDiscussions(context.pageUid);
      if (!alive.current || mine !== seq.current) return;
      setSnapshot(next);
      setError("");
      snapshotHandler.current(next);
    } catch (e) {
      if (alive.current && mine === seq.current)
        setError(
          e instanceof Error ? e.message : "Could not load discussions.",
        );
    } finally {
      if (alive.current && mine === seq.current) {
        reading.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [context.pageUid]);

  React.useEffect(() => {
    alive.current = true;
    void reload();
    const timer = window.setInterval(() => {
      if (!document.hidden && !reading.current) void reload();
    }, 15000);
    const visible = (): void => {
      if (!document.hidden && !reading.current) void reload();
    };
    document.addEventListener("visibilitychange", visible);
    let watching = false;
    const pattern = "[{:block/children ...}]";
    const entity = `[:block/uid ${JSON.stringify(context.pageUid)}]`;
    const changed = (): void => {
      if (!document.hidden && !reading.current) void reload();
    };
    const written = (): void => {
      void reload();
    };
    window.addEventListener(DISCUSSIONS_CHANGED, written);
    try {
      window.roamAlphaAPI.data.addPullWatch(pattern, entity, changed);
      watching = true;
    } catch {
      /* polling remains available */
    }
    return () => {
      alive.current = false;
      seq.current += 1;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener(DISCUSSIONS_CHANGED, written);
      if (watching) {
        try {
          window.roamAlphaAPI.data.removePullWatch(pattern, entity, changed);
        } catch {
          /* graph may have closed */
        }
      }
    };
  }, [context.pageUid, reload]);

  const rail = React.useRef<HTMLElement>(null);
  const [compact, setCompact] = React.useState(
    () => window.matchMedia?.("(max-width:650px)").matches || false,
  );
  React.useEffect(() => {
    const query = window.matchMedia?.("(max-width:650px)");
    if (!query) return;
    const update = (): void => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  React.useLayoutEffect(() => {
    if (compact && !rail.current?.contains(document.activeElement))
      closeButton.current?.focus({ preventScroll: true });
  }, [compact, snapshot]);
  const addressedThread =
    React.useMemo(
      () =>
        context.sourceUid &&
        snapshot.threads.find(
          (thread) =>
            thread.uid === context.sourceUid ||
            thread.replies.some((reply) => reply.uid === context.sourceUid),
        ),
      [context.sourceUid, snapshot.threads],
    ) || undefined;
  const selectedSource = addressedThread?.source.uid ?? context.sourceUid;
  // Apply a badge selection once. Background refreshes must leave the reader’s place alone.
  React.useLayoutEffect(() => {
    if (loading || error || appliedContext.current === context) return;
    appliedContext.current = context;
    const candidates = snapshot.threads.filter(
      (t) => !selectedSource || t.source.uid === selectedSource,
    );
    const matches = (thread: DiscussionThread): boolean =>
      filter === "all" || thread.resolved === (filter === "resolved");
    const first =
      addressedThread ||
      candidates.find((thread) => thread.uid === context.threadUid) ||
      candidates.find(matches) ||
      (selectedSource ? candidates[0] : undefined);
    if (first) {
      if (!matches(first)) setFilter(first.resolved ? "resolved" : "open");
      setExpanded((before) => new Set([...before, first.uid]));
    }
    if (selectedSource && !composing) setPreferredSource(selectedSource);
    setFocusTarget({ uid: selectedSource ? first?.uid : undefined });
  }, [
    loading,
    error,
    context,
    snapshot,
    filter,
    composing,
    addressedThread,
    selectedSource,
  ]);

  React.useLayoutEffect(() => {
    if (!focusTarget || !rail.current) return;
    const target = focusTarget.uid
      ? Array.from(
          rail.current.querySelectorAll<HTMLElement>("[data-thread-uid]"),
        ).find((node) => node.dataset.threadUid === focusTarget.uid)
      : rail.current.querySelector<HTMLButtonElement>(
          '[aria-label="Close discussions"]',
        );
    const scroll = rail.current.querySelector(".rmi-discussion-scroll");
    if (scroll) {
      scroll.scrollTop = 0;
      if (target && scroll.contains(target)) {
        const viewport = scroll.getBoundingClientRect();
        const article = target.getBoundingClientRect();
        if (article.bottom > viewport.bottom)
          scroll.scrollTop = Math.max(0, article.top - viewport.top);
      }
    }
    target?.focus({ preventScroll: true });
  }, [focusTarget]);

  const threads = snapshot.threads.filter(
    (t) =>
      filter === "all" || (filter === "resolved" ? t.resolved : !t.resolved),
  );
  const groups = new Map<string, DiscussionThread[]>();
  for (const thread of threads) {
    const group = groups.get(thread.source.uid);
    if (group) group.push(thread);
    else groups.set(thread.source.uid, [thread]);
  }
  const orderedGroups = [...groups].sort(
    ([a], [b]) => Number(b === selectedSource) - Number(a === selectedSource),
  );
  const composeButton = React.useRef<HTMLButtonElement | null>(null);
  const openCount = snapshot.threads.filter((t) => !t.resolved).length;
  const filterCounts: Record<Filter, number> = {
    open: openCount,
    all: snapshot.threads.length,
    resolved: snapshot.threads.length - openCount,
  };
  return (
    <aside
      ref={rail}
      role={compact ? "dialog" : undefined}
      aria-modal={compact || undefined}
      onKeyDown={(event) => {
        if (!compact || event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        ).filter((el) => el.getClientRects().length > 0);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      className="rmi-discussion-rail"
      aria-label="Page discussions"
    >
      <header className="rmi-discussion-header">
        <div>
          <h2>
            <Icon icon="chat" iconSize={16} aria-hidden="true" />
            Discussions
          </h2>
          <div className="rmi-discussion-page">{context.title}</div>
        </div>
        <div className="rmi-discussion-header-actions">
          <Button
            minimal
            small
            icon="refresh"
            aria-label="Refresh discussions"
            disabled={refreshing}
            onClick={() => void reload()}
          />
          <Button
            minimal
            small
            icon="cross"
            elementRef={closeButton}
            aria-label="Close discussions"
            onClick={onClose}
          />
        </div>
      </header>
      <div className="rmi-discussion-toolbar">
        <div
          className="rmi-discussion-filters"
          role="group"
          aria-label="Discussion filter"
        >
          {(["open", "all", "resolved"] as Filter[]).map((key) => (
            <Button
              key={key}
              minimal
              small
              active={filter === key}
              aria-pressed={filter === key}
              aria-description={`${filterCounts[key]} discussions`}
              aria-label={key[0].toUpperCase() + key.slice(1)}
              text={
                <>
                  {key[0].toUpperCase() + key.slice(1)}{" "}
                  <span className="rmi-filter-count">{filterCounts[key]}</span>
                </>
              }
              onClick={() => setFilter(key)}
            />
          ))}
        </div>
        <Button
          minimal
          small
          icon="plus"
          elementRef={composeButton}
          aria-expanded={composing}
          text={composing ? "Cancel" : "New thread"}
          disabled={loading || !snapshot.sources.length}
          onClick={() => setComposing(!composing)}
        />
      </div>
      <div className="rmi-discussion-scroll">
        {error && (
          <div className="rmi-discussion-error" role="alert">
            {error}
            <Button minimal small text="Retry" onClick={() => void reload()} />
          </div>
        )}
        {composing && (
          <section
            className="rmi-discussion-new"
            aria-label="Start a discussion"
          >
            <label htmlFor="rmi-discussion-source-select">
              Comment on a block
            </label>
            <HTMLSelect
              id="rmi-discussion-source-select"
              fill
              autoFocus
              value={sourceUid || ""}
              onChange={(e) => setPreferredSource(e.currentTarget.value)}
              options={snapshot.sources.map((s) => ({
                value: s.uid,
                label: prettify(s.string, null).slice(0, 100) || "Empty block",
              }))}
            />
            {sourceUid && (
              <Composer
                key={`new:${sourceUid}`}
                uid={sourceUid}
                isNew
                onPosted={async () => {
                  setFilter("open");
                  setComposing(false);
                  composeButton.current?.focus();
                  await reload();
                }}
              />
            )}
          </section>
        )}
        {loading ? (
          <div className="rmi-discussion-empty" role="status">
            <Spinner size={22} />
            <span>Loading discussions…</span>
          </div>
        ) : threads.length ? (
          orderedGroups.map(([uid, group]) => (
            <SourceGroup
              key={uid}
              threads={group}
              onNavigate={() => {
                if (compact) onClose();
              }}
            >
              {group.map((t) => (
                <Thread
                  key={t.uid}
                  thread={t}
                  selected={t.source.uid === selectedSource}
                  expanded={expanded.has(t.uid)}
                  reload={reload}
                  toggle={() =>
                    setExpanded((before) => {
                      const next = new Set(before);
                      if (next.has(t.uid)) next.delete(t.uid);
                      else next.add(t.uid);
                      return next;
                    })
                  }
                />
              ))}
            </SourceGroup>
          ))
        ) : (
          !error && (
            <div className="rmi-discussion-empty">
              <strong>
                {filter === "resolved"
                  ? "No resolved discussions"
                  : filter === "all"
                    ? "No discussions yet"
                    : "No open discussions"}
              </strong>
              <span>
                {filter === "resolved"
                  ? "Threads appear here when you resolve them."
                  : snapshot.sources.length
                    ? "Choose a block and start a conversation."
                    : "Add a block to this page to start a discussion."}
              </span>
              {filter !== "resolved" && snapshot.sources.length > 0 && (
                <Button
                  outlined
                  small
                  icon="plus"
                  text="Start a discussion"
                  onClick={() => setComposing(true)}
                />
              )}
            </div>
          )
        )}
      </div>
    </aside>
  );
};
