import { LensApiRequest } from "../router"
import { LensApi } from "../lens-api"
import { userStore } from "../../common/user-store"
import { getAppVersion } from "../../common/app-utils"
import { CoreV1Api, AuthorizationV1Api } from "@kubernetes/client-node"
import { Cluster } from "../cluster"

async function getAllowedNamespaces(cluster: Cluster) {
  const api = cluster.contextHandler.kc.makeApiClient(CoreV1Api)
  try {
    const namespaceList = await api.listNamespace()
    const nsAccessStatuses = await Promise.all(
      namespaceList.body.items.map(ns => cluster.canI({
        namespace: ns.metadata.name,
        resource: "pods",
        verb: "list",
      }))
    )
    return namespaceList.body.items
      .filter((ns, i) => nsAccessStatuses[i])
      .map(ns => ns.metadata.name)
  } catch(error) {
    const kc = cluster.contextHandler.kc
    const ctx = kc.getContextObject(kc.currentContext)
    if (ctx.namespace) {
      return [ctx.namespace]
    } else {
      return []
    }
  }
}

async function getAllowedResources(cluster: Cluster, namespaces: string[]) {
  // TODO: auto-populate all resources dynamically
  const resources = [
    "configmaps",
    "cronjobs",
    "customresourcedefinitions",
    "daemonsets",
    "deployments",
    "endpoints",
    "horizontalpodautoscalers",
    "ingresses",
    "jobs",
    "namespaces",
    "networkpolicies",
    "nodes",
    "persistentvolumes",
    "pods",
    "podsecuritypolicies",
    "resourcequotas",
    "secrets",
    "services",
    "statefulsets",
    "storageclasses",
  ]
  try {
    const resourceAccessStatuses = await Promise.all(
      resources.map(resource => cluster.canI({
        resource: resource,
        verb: "list",
        namespace: namespaces[0]
      }))
    )
    return resources
      .filter((resource, i) => resourceAccessStatuses[i])
  } catch(error) {
    return []
  }
}

class ConfigRoute extends LensApi {

  public async routeConfig(request: LensApiRequest) {
    const { params, response, cluster} = request

    const namespaces = await getAllowedNamespaces(cluster)
    const data = {
      clusterName: cluster.contextName,
      lensVersion: getAppVersion(),
      lensTheme: `kontena-${userStore.getPreferences().colorTheme}`,
      kubeVersion: cluster.version,
      chartsEnabled: true,
      isClusterAdmin: cluster.isAdmin,
      allowedResources: await getAllowedResources(cluster, namespaces),
      allowedNamespaces: namespaces
    };

    this.respondJson(response, data)
  }
}

export const configRoute = new ConfigRoute()
