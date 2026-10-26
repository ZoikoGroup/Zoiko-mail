import { Router } from "express";
import { validate } from "../../common/middleware/validate.js";
import { idempotency, requireCapability } from "../../common/middleware/index.js";
import {
  createContactSchema,
  updateContactSchema,
  listContactsSchema,
  contactIdParamsSchema,
  importContactsSchema,
  mergeContactsSchema,
  searchSchema,
  activitySchema,
} from "./contact.schema.js";
import * as controller from "./contact.controller.js";

export const contactRouter = Router();

// Contacts are one's own work, like one's mail: the same capability gates
// them, and every write is idempotent like every other tenant-scoped write.
// (authenticate and tenantContext are applied where the router is mounted.)
contactRouter.use(requireCapability("mail.own.rw"), idempotency);

contactRouter.get("/", validate(listContactsSchema, "query"), controller.list);
contactRouter.get("/summary", controller.summary);
contactRouter.get("/tags", controller.listTags);
contactRouter.get("/suggest", controller.suggest);
contactRouter.get("/directory", validate(searchSchema, "query"), controller.directory);
contactRouter.get("/other", validate(searchSchema, "query"), controller.otherContacts);
contactRouter.get("/activity", validate(activitySchema, "query"), controller.activity);
contactRouter.get("/duplicates", controller.duplicates);
contactRouter.post("/", validate(createContactSchema), controller.create);
contactRouter.post("/import", validate(importContactsSchema), controller.importContacts);
contactRouter.post("/merge", validate(mergeContactsSchema), controller.merge);
contactRouter.get("/:contactId", validate(contactIdParamsSchema, "params"), controller.getById);
contactRouter.patch("/:contactId", validate(contactIdParamsSchema, "params"), validate(updateContactSchema), controller.update);
contactRouter.delete("/:contactId", validate(contactIdParamsSchema, "params"), controller.remove);
