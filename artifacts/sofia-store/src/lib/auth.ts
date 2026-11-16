import { useGetSession, getGetSessionQueryKey } from "@workspace/api-client-react";

/** Session query + request options carrying the CSRF header for every mutation. */
export function useSessionCsrf() {
  const session = useGetSession({ query: { queryKey: getGetSessionQueryKey(), staleTime: 30_000 } });
  const token = session.data?.csrfToken ?? "";
  const request = { headers: { "x-csrf-token": token } };
  return { session, token, request };
}
