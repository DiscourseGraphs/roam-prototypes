import { Button, type IconName } from "@blueprintjs/core";
import React, { useLayoutEffect, useRef, useState } from "react";

export const HOME_TITLE = "🥾 Home";

const DESTINATIONS = [
  {
    label: "Team front page",
    title: "🚪 Discourse graphs front page for team members",
    description: "Find team resources and get oriented.",
    icon: "people",
  },
  {
    label: "Dashboard",
    title: "📊 Dashboard",
    description: "Open the shared project dashboard.",
    icon: "dashboard",
  },
  {
    label: "My Homepage",
    title: null,
    description: "Go to your personal page in this graph.",
    icon: "home",
  },
  {
    label: "Sync / All Hands",
    title: "Sync / All Hands",
    description: "Find the team’s all-hands notes.",
    icon: "calendar",
  },
] as const satisfies ReadonlyArray<{
  label: string;
  title: string | null;
  description: string;
  icon: IconName;
}>;

type Destination = (typeof DESTINATIONS)[number];

const personalHomeTitle = async (): Promise<string | null> => {
  const api = window.roamAlphaAPI;
  const userUid = api.user.uid();
  if (!userUid) return null;
  const [[name] = []] = await api.data.async.q(
    `[:find ?name
      :in $ ?uid
      :where
      [?user :user/uid ?uid]
      [?user :user/display-page ?page]
      [?page :node/title ?name]]`,
    userUid,
  );
  return typeof name === "string" && name ? `${name}/Home` : null;
};

const findPage = async (title: string): Promise<string | null> => {
  const [[uid] = []] = await window.roamAlphaAPI.data.async.q(
    "[:find ?uid :in $ ?title :where [?page :node/title ?title] [?page :block/uid ?uid]]",
    title,
  );
  return typeof uid === "string" && uid ? uid : null;
};

export const Home = (): JSX.Element => {
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string>();
  const pending = useRef(false);
  const active = useRef(true);
  useLayoutEffect(
    () => () => {
      active.current = false;
    },
    [],
  );

  const open = async (destination: Destination): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setOpening(destination.label);
    setError("");
    try {
      const title = destination.title ?? (await personalHomeTitle());
      if (!active.current) return;
      if (!title) {
        setError("Roam couldn’t identify your user. Try reloading the graph.");
        return;
      }
      const uid = await findPage(title);
      if (!active.current) return;
      if (!uid) {
        setError(`Couldn’t find “${title}” in this graph.`);
        return;
      }
      await window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid } });
    } catch {
      if (active.current)
        setError(`Couldn’t open ${destination.label}. Try again.`);
    } finally {
      pending.current = false;
      if (active.current) setOpening(undefined);
    }
  };

  return (
    <nav aria-label="Graph home shortcuts">
      <p className="dg-graph-home-intro">Jump to a page in this graph.</p>
      <div className="dg-graph-home-links">
        {DESTINATIONS.map((destination) => (
          <Button
            className="dg-graph-home-link"
            key={destination.label}
            minimal
            icon={destination.icon}
            rightIcon="chevron-right"
            aria-disabled={opening !== undefined}
            aria-busy={opening === destination.label}
            onClick={() => void open(destination)}
            text={
              <span className="dg-graph-home-label">
                <strong>{destination.label}</strong>
                <span>{destination.description}</span>
              </span>
            }
          />
        ))}
      </div>
      {error && (
        <p className="dg-graph-home-error" role="alert">
          {error}
        </p>
      )}
    </nav>
  );
};
