/* Shared data shapes. The tree/value/slot vocabulary is inherited from the
 * roam/js prototype (DiscourseGraphs/dg-properties-panel) so its offline test
 * suite ports pin-for-pin. */

export type Tree = {
  uid: string;
  string: string;
  children: Tree[];
};

export type Value =
  | { kind: "empty"; raw: string; infoLink?: boolean }
  | { kind: "page"; raw: string; title: string }
  | { kind: "number"; raw: string; num: number }
  | { kind: "url"; raw: string; url: string; label?: string }
  | { kind: "blockref"; raw: string; uid: string; label?: string }
  | { kind: "text"; raw: string };

export type SlotChild = { uid: string; text: string; value: Value };

export type Slot = {
  key: string;
  uid: string | null;
  valueRaw: string;
  value: Value;
  children: SlotChild[];
};

export type Extra =
  | { type: "static"; uid: string; key: string; valueRaw: string }
  | { type: "button"; uid: string; label: string; workflow: string };

export type Anomaly =
  | { type: "duplicate-key"; uid: string; key: string }
  | { type: "unrecognized"; uid: string; text: string };

export type ParsedProps = {
  blockUid: string;
  slots: Slot[];
  extras: Extra[];
  anomalies: Anomaly[];
};

export type InlineToken =
  | { t: "text"; s: string }
  | { t: "link"; text: string; url: string }
  | { t: "page"; title: string }
  | { t: "blockref"; uid: string; label?: string };

export type RegistryEntry = {
  name: string;
  type: string | null;
  range: [number, number] | null;
  options: ({ raw: string } & Value)[] | null;
  optionsUid: string | null;
  dynamic: { kind: string; query: string | null; raw: string } | null;
  template: string | null;
  customPattern: string | null;
  customReplacement: string | null;
};

export type Registry = Record<string, RegistryEntry>;

export type PickerOption = { title: string; raw?: string; kind?: string; label?: string };

export type WriteOp =
  | { op: "update"; uid: string; string: string }
  | { op: "delete"; uid: string }
  | { op: "create"; parentUid: string; order: number; string: string; thenChildren?: string[] };

export type NodeType = { name: string; format: string; templateUid: string | null };

export type ConfigAction = { key: string; label: string; enabled: boolean; badge?: string };
