import { handleApiRequest } from "../../server/api.js"

export function onRequest(context) {
  return handleApiRequest(context.request, context.env)
}
