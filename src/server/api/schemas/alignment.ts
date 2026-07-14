import type { WeakEntityTag } from "../../../shared/api/common";

/**
 * Normalize TypeBox's mutable wire representation and the readonly DTO authoring
 * style before comparing their complete shapes. Weak ETags are template-literal
 * strings in DTOs, while their runtime validator necessarily exposes `string`.
 */
type NormalizeWireShape<Value> = Value extends WeakEntityTag
	? string
	: Value extends readonly (infer Item)[]
		? NormalizeWireShape<Item>[]
		: Value extends object
			? {
					-readonly [Key in keyof Value]: NormalizeWireShape<Value[Key]>;
				}
			: Value;

export type ExactWireShape<Left, Right> = [NormalizeWireShape<Left>] extends [
	NormalizeWireShape<Right>,
]
	? [NormalizeWireShape<Right>] extends [NormalizeWireShape<Left>]
		? true
		: false
	: false;
