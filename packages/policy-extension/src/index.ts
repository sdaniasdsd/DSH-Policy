/** Host plugin entry for the Policy extension Bundle. */

export { POLICY_COMPATIBILITY, type PolicyCompatibility } from './compatibility.ts'

/** Host activation entry. Policy services are added by the controller package. */
export function apply(): void {}
