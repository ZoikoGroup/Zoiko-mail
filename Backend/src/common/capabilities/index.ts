export {
  CAPABILITIES,
  RESOLVER_KINDS,
  REASONS,
  isCapability,
  type Capability,
  type ResolverKind,
  type Reason,
} from "./capabilities.js";

export {
  CAPABILITY_MATRIX,
  capabilitiesFor,
  matrixKind,
  rolesHolding,
} from "./matrix.js";

export {
  can,
  capabilitySnapshot,
  resolveCapability,
  type CapabilityContext,
  type CapabilityDecision,
} from "./resolver.js";
