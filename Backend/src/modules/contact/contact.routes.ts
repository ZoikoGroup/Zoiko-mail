import { Router } from "express";
import { validate } from "../../common/middleware/validate.js";
import {
  createContactSchema,
  updateContactSchema,
  listContactsSchema,
  contactIdParamsSchema,
} from "./contact.schema.js";
import * as controller from "./contact.controller.js";

export const contactRouter = Router();

contactRouter.get("/", validate(listContactsSchema, "query"), controller.list);
contactRouter.get("/tags", controller.listTags);
contactRouter.get("/suggest", controller.suggest);
contactRouter.post("/", validate(createContactSchema), controller.create);
contactRouter.get("/:contactId", validate(contactIdParamsSchema, "params"), controller.getById);
contactRouter.patch("/:contactId", validate(contactIdParamsSchema, "params"), validate(updateContactSchema), controller.update);
contactRouter.delete("/:contactId", validate(contactIdParamsSchema, "params"), controller.remove);