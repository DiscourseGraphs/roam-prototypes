/* THE BLOCKS REMAIN THE ONLY STORE. Every edit the panel makes is a plain
 * text block write in canonical form (page-link vocabularies write [[...]],
 * string vocabularies write bare text, multi-value slots write child
 * blocks). Values are never mirrored anywhere. */

import { CONFIG } from "~/config";
import type { WriteOp } from "~/types";

const api = () => (window as any).roamAlphaAPI;

export const applyOps = async (ops: WriteOp[]): Promise<void> => {
  for (const op of ops) {
    if (op.op === "update")
      await api().data.block.update({ block: { uid: op.uid, string: op.string } });
    else if (op.op === "delete") await api().data.block.delete({ block: { uid: op.uid } });
    else if (op.op === "create") {
      const uid = api().util.generateUID();
      await api().data.block.create({
        location: { "parent-uid": op.parentUid, order: op.order },
        block: { uid, string: op.string },
      });
      for (let i = 0; i < (op.thenChildren || []).length; i++)
        await api().data.block.create({
          location: { "parent-uid": uid, order: i },
          block: { string: op.thenChildren![i] },
        });
    }
  }
  // The editor store lags API writes; wait before the caller re-reads.
  await new Promise((res) => setTimeout(res, CONFIG.writeSettleMs));
};
