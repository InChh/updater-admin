import { ErrorBoundary } from "react-error-boundary";

import PageError from "@/pages/sys/error/PageError";
import { withAuthenticationRequired } from "react-oidc-context";

type Props = {
	children: React.ReactNode;
};
const ProtectedRoute = ({ children }: Props) => {
	return <ErrorBoundary FallbackComponent={PageError}>{children}</ErrorBoundary>;
};

export default withAuthenticationRequired(ProtectedRoute);
