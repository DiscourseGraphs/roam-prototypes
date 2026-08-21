/* Fixtures mirror real dg-team content: the properties block of
 * "[[ISS]] - send evd + citation to your authoring platform" and the
 * relevant slices of roam/js/attribute-select. Ported unchanged from the
 * roam/js prototype's offline suite. */

import { expect, it } from "vitest";
import type { Tree } from "~/types";

/** Pin adapter: keeps the ported assertions line-for-line comparable to the
 * roam/js suite (which compared JSON.stringify output). */
export const eq = (name: string, got: unknown, want: unknown) =>
  it(name, () => expect(got).toEqual(want));

// The real ISS properties block (uids shortened), plus one deliberate
// multi-value slot and one drift value for coverage.
export const issProps: Tree = {
  uid: "MiMLS_5gT",
  string: "**Properties** #.properties",
  children: [
    { uid: "u-linear", string: "Linear:: ", children: [] },
    { uid: "u-prio", string: "Priority:: 12", children: [] },
    { uid: "u-status", string: "Issue Status:: [[🌱 Exploration]]", children: [] },
    { uid: "u-type", string: "Issue Type:: [[🗳️ Feature Request]]", children: [] },
    {
      uid: "u-project",
      string: "Project:: [[Project/Legacy documents to and from discourse nodes]]",
      children: [],
    },
    { uid: "u-func", string: "Function:: [[[[UC]] - Manuscript writing]]", children: [] },
    { uid: "u-flow", string: "Flow::", children: [] },
    { uid: "u-lead", string: "Lead:: ", children: [] },
  ],
};

export const driftProps: Tree = {
  uid: "p2",
  string: "🏷️ #.properties",
  children: [
    { uid: "d-status", string: "Issue Status:: 🚀 Active", children: [] },
    // Single colon — DELIBERATE (renders as link, not attribute). Read-only row.
    {
      uid: "d-linear",
      string:
        "Linear: [TLDraw sync between graphs](https://linear.app/discourse-graphs/project/tldraw-sync)",
      children: [],
    },
    { uid: "d-dup", string: "Issue Status:: [[🧊 Iced]]", children: [] }, // duplicate
    {
      uid: "d-init",
      string: "Initiative::",
      children: [
        {
          uid: "d-i1",
          string: "[[Initiative/Way smoother discourse relations]]",
          children: [],
        },
        {
          uid: "d-i2",
          string: "[[Initiative/Streamline existing DG implementation in Roam]]",
          children: [],
        },
      ],
    },
    // SmartBlock button (navigates to the project canvas).
    {
      uid: "d-btn",
      string: "{{Project canvas:SmartBlock:Page Canvas:RemoveButton=false,Icon=presentation}}",
      children: [],
    },
    { uid: "d-junk", string: "?? stray text without any colon pattern", children: [] },
  ],
};

// attribute-select slices, structured exactly like the live page.
export const registryTree: Tree = {
  uid: "fyQMVe5mA",
  string: "roam/js/attribute-select",
  children: [
    {
      uid: "r-attrs",
      string: "attributes",
      children: [
        {
          uid: "r-prio",
          string: "Priority",
          children: [
            {
              uid: "r-p-t",
              string: "type",
              children: [{ uid: "r-p-t1", string: "number", children: [] }],
            },
            {
              uid: "r-p-r",
              string: "range",
              children: [
                { uid: "r-p-r0", string: "0", children: [] },
                { uid: "r-p-r1", string: "100", children: [] },
              ],
            },
            {
              uid: "r-p-o",
              string: "options",
              children: [{ uid: "r-p-o1", string: "Critical (85%)", children: [] }],
            },
          ],
        },
        {
          uid: "r-status",
          string: "Issue Status",
          children: [
            { uid: "r-s-r", string: "range", children: [] },
            {
              uid: "r-s-o",
              string: "options",
              children: [
                { uid: "r-s-o1", string: "[[🤔 Considering]]", children: [] },
                { uid: "r-s-o2", string: "[[🌱 Exploration]]", children: [] },
                { uid: "r-s-o3", string: "[[🚀 Active]]", children: [] },
                { uid: "r-s-o4", string: "[[🧊 Iced]]", children: [] },
              ],
            },
          ],
        },
        {
          uid: "r-art",
          string: "ArtStatus",
          children: [
            {
              uid: "r-a-t",
              string: "template",
              children: [{ uid: "r-a-t1", string: "No styling", children: [] }],
            },
            {
              uid: "r-a-o",
              string: "options",
              children: [
                { uid: "r-a-o1", string: "🧪 Alpha", children: [] },
                { uid: "r-a-o2", string: "🎯 Beta", children: [] },
              ],
            },
            { uid: "r-a-r", string: "range", children: [] },
          ],
        },
        {
          uid: "r-lead",
          string: "Lead",
          children: [
            {
              uid: "r-l-o",
              string: "options",
              children: [
                { uid: "r-l-o1", string: "<%ACTIVEUSERS:this month%>", children: [] },
              ],
            },
            { uid: "r-l-r", string: "range", children: [] },
          ],
        },
        {
          uid: "r-proj",
          string: "Project",
          children: [
            { uid: "r-pr-r", string: "range", children: [] },
            {
              uid: "r-pr-o",
              string: "options",
              children: [
                {
                  uid: "r-pr-o1",
                  string: "<%QUERYBUILDER:activeProjects,<%TAG:{text}%>%>",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// Node-type template properties block (declares slot order, incl. Flow/Lead).
export const templateProps: Tree = {
  uid: "tpl",
  string: "**Properties** #.properties",
  children: [
    { uid: "t1", string: "Linear::", children: [] },
    { uid: "t2", string: "Priority::", children: [] },
    { uid: "t3", string: "Issue Status::", children: [] },
    { uid: "t4", string: "Issue Type::", children: [] },
    { uid: "t5", string: "Project::", children: [] },
    { uid: "t6", string: "Function::", children: [] },
    { uid: "t7", string: "Flow::", children: [] },
    { uid: "t8", string: "Lead::", children: [] },
  ],
};
