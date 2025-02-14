export interface Result<T = any> {
	status: number;
	message: string;
	data?: T;
}

export interface ErrorResponse {
	error: {
		code: string;
		message: string;
		details: string;
		data: any;
		validationErrors: ValidationError[];
	};
}

export interface ValidationError {
	message: string;
	members: string[];
}
