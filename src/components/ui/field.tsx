import type { JSX } from "solid-js";
import { Show } from "solid-js";

import { cn } from "../../lib/utils";

export interface FieldProps {
	readonly children: (controlProps: FieldControlProps) => JSX.Element;
	readonly class?: string;
	readonly description?: string;
	readonly error?: string;
	readonly label: string;
	readonly name: string;
	readonly required?: boolean;
}

export interface FieldControlProps {
	readonly "aria-describedby"?: string;
	readonly "aria-invalid"?: true;
	readonly "aria-required"?: true;
	readonly id: string;
}

export function Field(props: FieldProps) {
	const descriptionId = () => `${props.name}-description`;
	const errorId = () => `${props.name}-error`;
	return (
		<div class={cn("grid gap-1.5", props.class)}>
			<label class="text-sm font-medium text-ink" for={props.name}>
				<Show when={props.required}>
					<span aria-hidden="true" class="mr-1 text-danger">
						*
					</span>
				</Show>
				{props.label}
			</label>
			{props.children({
				...(props.error ? { "aria-describedby": errorId() } : {}),
				...(props.error ? { "aria-invalid": true as const } : {}),
				...(props.required ? { "aria-required": true as const } : {}),
				...(!props.error && props.description
					? { "aria-describedby": descriptionId() }
					: {}),
				id: props.name,
			})}
			<Show when={props.description && !props.error}>
				<p class="m-0 text-xs text-muted" id={descriptionId()}>
					{props.description}
				</p>
			</Show>
			<Show when={props.error}>
				<p class="m-0 text-xs text-danger" id={errorId()} role="alert">
					{props.error}
				</p>
			</Show>
		</div>
	);
}
