/**
 * Frozen shared contracts for FoodProof phase one (T0).
 * UI agents (T2/T3) and service agents (T1) import types/schemas from here and
 * never redefine them. Changes are shared-contract changes owned by the
 * integration owner (see AGENTS.md and FOODPROOF_BUILD_TICKETS.md).
 */
export * from "./enums";
export * from "./envelope";
export * from "./public";
export * from "./entities";
export * from "./requests";
export * from "./analytics";
