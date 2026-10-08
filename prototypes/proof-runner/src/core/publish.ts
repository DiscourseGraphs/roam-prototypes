// A publish fixture writes what another space's publish would have written,
// so a kit can import shared nodes without driving a second app: the node
// types (schema concepts), the nodes with their Document and direct/full
// Content rows, and ResourceAccess for a group the target graph is in.
// Shapes follow rows the real publishes wrote: Obsidian keeps a type's format
// in source_data and names nodes after their files; Roam keeps the format at
// the top level. Every write is an upsert, so the fixture runs on every take.

export type PublishType = {
  id: string;
  label: string;
  format: string;
  template?: string;
};

export type PublishNode = {
  id: string;
  type: string;
  title: string;
  body?: string;
};

export type PublishSpec = {
  space: number;
  author: number;
  group: string;
  types: PublishType[];
  nodes: PublishNode[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const LOCAL_ID = /^[\w.@-]{1,120}$/;
const GROUP_NAME = /^[a-z0-9][a-z0-9.-]{0,80}$/;

export const validatePublishSpec = (value: unknown, where: string): PublishSpec => {
  if (!isRecord(value)) throw new Error(`${where}: publish is an object.`);
  if (!Number.isInteger(value.space) || !Number.isInteger(value.author)) {
    throw new Error(`${where}: publish needs space and author ids (numbers).`);
  }
  if (typeof value.group !== "string" || !GROUP_NAME.test(value.group)) {
    throw new Error(`${where}: group is a group's name, like "eng-2329-demo".`);
  }
  if (!Array.isArray(value.types) || !Array.isArray(value.nodes)) {
    throw new Error(`${where}: publish needs types and nodes arrays.`);
  }
  const types = value.types.map((raw, index): PublishType => {
    const at = `${where}.types[${index}]`;
    if (!isRecord(raw) || !isText(raw.id) || !isText(raw.label) || !isText(raw.format)) {
      throw new Error(`${at}: a type is { id, label, format, template? }.`);
    }
    if (!LOCAL_ID.test(raw.id)) throw new Error(`${at}: id may use letters, digits, _ . @ and -.`);
    if (!raw.format.includes("{content}")) throw new Error(`${at}: format needs {content}.`);
    if (raw.template !== undefined && typeof raw.template !== "string") {
      throw new Error(`${at}: template is markdown text.`);
    }
    const type: PublishType = { id: raw.id, label: raw.label, format: raw.format };
    if (typeof raw.template === "string") type.template = raw.template;
    return type;
  });
  const typeIds = new Set(types.map((type) => type.id));
  const nodes = value.nodes.map((raw, index): PublishNode => {
    const at = `${where}.nodes[${index}]`;
    if (!isRecord(raw) || !isText(raw.id) || !isText(raw.type) || !isText(raw.title)) {
      throw new Error(`${at}: a node is { id, type, title, body? }.`);
    }
    if (!LOCAL_ID.test(raw.id)) throw new Error(`${at}: id may use letters, digits, _ . @ and -.`);
    if (!typeIds.has(raw.type)) throw new Error(`${at}: type "${raw.type}" isn't in types.`);
    const node: PublishNode = { id: raw.id, type: raw.type, title: raw.title };
    if (typeof raw.body === "string") node.body = raw.body;
    return node;
  });
  return { space: value.space as number, author: value.author as number, group: value.group, types, nodes };
};

// Dollar quoting keeps any text literal; the tag can't occur in the text.
const literal = (text: string): string => {
  let tag = "pk";
  while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$`;
};

const json = (value: unknown): string => `${literal(JSON.stringify(value))}::jsonb`;

const decorate = (format: string, title: string): string => format.replace("{content}", title);

export const groupEmail = (group: string): string => `${group}@groups.discoursegraphs.com`;

export const publishSql = (spec: PublishSpec): string => {
  const space = spec.space;
  const author = spec.author;
  const group = `(SELECT id FROM auth.users WHERE email = ${literal(groupEmail(spec.group))})`;
  const platform = `(SELECT platform::text FROM "Space" WHERE id = ${space})`;
  const lines: string[] = [
    "BEGIN;",
    `DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Space" WHERE id = ${space}) THEN RAISE EXCEPTION 'No space ${space} in the local database'; END IF;
  IF ${group} IS NULL THEN RAISE EXCEPTION 'No group %', ${literal(groupEmail(spec.group))}; END IF;
END $check$;`,
  ];
  // Publishing to a group also gives the group partial access to the space;
  // without it the group's members can't see the space or its nodes.
  lines.push(
    `INSERT INTO "SpaceAccess" (account_uid, space_id, permissions) VALUES (${group}, ${space}, 'partial') ON CONFLICT (account_uid, space_id) DO NOTHING;`,
  );
  const share = (localId: string): string =>
    `INSERT INTO "ResourceAccess" (account_uid, space_id, source_local_id) VALUES (${group}, ${space}, ${literal(localId)}) ON CONFLICT DO NOTHING;`;

  for (const type of spec.types) {
    const obsidian = {
      label: type.label,
      source_data: { format: type.format },
      template_content: type.template ?? null,
    };
    const roam: Record<string, unknown> = { label: type.label, format: type.format };
    if (type.template !== undefined) roam.template_content = type.template;
    lines.push(
      `INSERT INTO "Concept" (name, author_id, created, last_modified, space_id, literal_content, is_schema, reference_content, arity, source_local_id, is_relation)
VALUES (${literal(type.label)}, ${author}, now(), now(), ${space},
  CASE WHEN ${platform} = 'Obsidian' THEN ${json(obsidian)} ELSE ${json(roam)} END,
  true, '{}', 0, ${literal(type.id)}, false)
ON CONFLICT (space_id, source_local_id) DO UPDATE SET name = EXCLUDED.name, literal_content = EXCLUDED.literal_content, last_modified = now();`,
      share(type.id),
    );
  }

  for (const node of spec.nodes) {
    const type = spec.types.find((item) => item.id === node.type) as PublishType;
    const title = decorate(type.format, node.title);
    const body = node.body ?? "";
    const schema = `(SELECT id FROM "Concept" WHERE space_id = ${space} AND source_local_id = ${literal(type.id)})`;
    const obsidianFull = [
      "---",
      `nodeTypeId: ${type.id}`,
      `nodeInstanceId: ${node.id}`,
      "---",
      body,
    ].join("\n");
    lines.push(
      `INSERT INTO "Concept" (name, author_id, created, last_modified, space_id, schema_id, literal_content, is_schema, reference_content, arity, source_local_id, is_relation)
VALUES (
  CASE WHEN ${platform} = 'Obsidian' THEN ${literal(`${title}.md`)} ELSE ${literal(title)} END,
  ${author}, now(), now(), ${space}, ${schema},
  CASE WHEN ${platform} = 'Obsidian' THEN ${json({ label: title, core_title: node.title, source_data: {} })} ELSE ${json({ core_title: node.title })} END,
  false, '{}', 0, ${literal(node.id)}, false)
ON CONFLICT (space_id, source_local_id) DO UPDATE SET name = EXCLUDED.name, schema_id = EXCLUDED.schema_id, literal_content = EXCLUDED.literal_content, last_modified = now();`,
      `INSERT INTO "Document" (space_id, source_local_id, created, last_modified, metadata, author_id, content_type)
VALUES (${space}, ${literal(node.id)}, now(), now(), '{}', ${author},
  CASE WHEN ${platform} = 'Obsidian' THEN 'text/obsidian+markdown' ELSE 'text/roam+markdown' END)
ON CONFLICT (space_id, source_local_id) DO UPDATE SET last_modified = now();`,
      `INSERT INTO "Content" (document_id, source_local_id, author_id, created, last_modified, text, metadata, scale, space_id, variant, content_type, original)
VALUES (
  (SELECT id FROM "Document" WHERE space_id = ${space} AND source_local_id = ${literal(node.id)}),
  ${literal(node.id)}, ${author}, now(), now(), ${literal(title)},
  CASE WHEN ${platform} = 'Obsidian' THEN ${json({ filePath: `${title}.md` })} ELSE '{}'::jsonb END,
  'document', ${space}, 'direct', 'text/plain', true)
ON CONFLICT (space_id, source_local_id, variant, content_type) DO UPDATE SET text = EXCLUDED.text, metadata = EXCLUDED.metadata, last_modified = now();`,
      `INSERT INTO "Content" (document_id, source_local_id, author_id, created, last_modified, text, metadata, scale, space_id, variant, content_type, original)
VALUES (
  (SELECT id FROM "Document" WHERE space_id = ${space} AND source_local_id = ${literal(node.id)}),
  ${literal(node.id)}, ${author}, now(), now(),
  CASE WHEN ${platform} = 'Obsidian' THEN ${literal(obsidianFull)} ELSE ${literal(body)} END,
  CASE WHEN ${platform} = 'Obsidian' THEN ${json({ nodeTypeId: type.id, nodeInstanceId: node.id })} ELSE '{}'::jsonb END,
  'document', ${space}, 'full',
  CASE WHEN ${platform} = 'Obsidian' THEN 'text/obsidian+markdown' ELSE 'text/roam+markdown' END, true)
ON CONFLICT (space_id, source_local_id, variant, content_type) DO UPDATE SET text = EXCLUDED.text, metadata = EXCLUDED.metadata, last_modified = now();`,
      share(node.id),
    );
  }
  lines.push("COMMIT;");
  return lines.join("\n");
};
