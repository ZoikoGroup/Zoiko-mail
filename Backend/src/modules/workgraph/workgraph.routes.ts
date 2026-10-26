import { Router } from "express";
import { validate } from "../../common/middleware/validate.js";
import * as controller from "./workgraph.controller.js";
import {
  addEvidenceSchema,
  commitmentSchema,
  confirmSuggestionSchema,
  decideSchema,
  decisionSchema,
  dependencySchema,
  idParamsSchema,
  streamSchema,
  updateCommitmentSchema,
  updateDecisionSchema,
  updateDependencySchema,
  updateStreamSchema,
} from "./workgraph.schema.js";

/**
 * The Work Graph, for the signed-in member. What anyone sees is decided per
 * item (shared with the workspace, or just theirs), so no capability beyond an
 * active membership is needed: an item someone keeps private answers 404.
 */
export const workGraphRouter = Router();
const params = validate(idParamsSchema, "params");

workGraphRouter.get("/people", controller.people);
workGraphRouter.get("/overview", controller.overview);

workGraphRouter.get("/streams", controller.listStreams);
workGraphRouter.post("/streams", validate(streamSchema), controller.createStream);
workGraphRouter.patch("/streams/:id", params, validate(updateStreamSchema), controller.updateStream);
workGraphRouter.delete("/streams/:id", params, controller.deleteStream);

workGraphRouter.get("/commitments", controller.listCommitments);
workGraphRouter.post("/commitments", validate(commitmentSchema), controller.createCommitment);
workGraphRouter.get("/commitments/:id", params, controller.getCommitment);
workGraphRouter.patch("/commitments/:id", params, validate(updateCommitmentSchema), controller.updateCommitment);
workGraphRouter.delete("/commitments/:id", params, controller.deleteCommitment);

workGraphRouter.get("/decisions", controller.listDecisions);
workGraphRouter.post("/decisions", validate(decisionSchema), controller.createDecision);
workGraphRouter.get("/decisions/:id", params, controller.getDecision);
workGraphRouter.patch("/decisions/:id", params, validate(updateDecisionSchema), controller.updateDecision);
workGraphRouter.post("/decisions/:id/decision", params, validate(decideSchema), controller.decide);
workGraphRouter.delete("/decisions/:id", params, controller.deleteDecision);

workGraphRouter.get("/dependencies", controller.listDependencies);
workGraphRouter.post("/dependencies", validate(dependencySchema), controller.createDependency);
workGraphRouter.patch("/dependencies/:id", params, validate(updateDependencySchema), controller.updateDependency);
workGraphRouter.delete("/dependencies/:id", params, controller.deleteDependency);

workGraphRouter.post("/evidence", validate(addEvidenceSchema), controller.addEvidence);
workGraphRouter.delete("/evidence/:id", params, controller.removeEvidence);

workGraphRouter.get("/suggestions", controller.listSuggestions);
workGraphRouter.post("/suggestions/:id/confirm", params, validate(confirmSuggestionSchema), controller.confirmSuggestion);
workGraphRouter.post("/suggestions/:id/dismiss", params, controller.dismissSuggestion);
