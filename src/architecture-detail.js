"use strict";

const watches = require("./architecture-watch");

function inventory(arch, resolved) {
  if (!Array.isArray(arch.NodeList) || !Array.isArray(resolved.ArchNodeList)) throw new Error("Invalid architecture resource response");
  const nodes = new Map(arch.NodeList.map(node => [String(node.NodeId), node]));
  const resources = new Map(), products = new Map();
  for (const node of resolved.ArchNodeList) {
    const source = nodes.get(String(node.NodeId));
    if (!source || !Array.isArray(node.ResourceList)) continue;
    if (!source.BindingType && !node.ResourceList.length) continue;
    const product = node.ProductType, cloudProvider = node.CloudProvider || source.CloudProvider || "tencent";
    const productKey = `${cloudProvider}:${product}`;
    if (!products.has(productKey)) products.set(productKey, { id: productKey, product, name: source.Description || product,
      cloudProvider, resourceCount: 0, regions: [], capacitySupported: cloudProvider === "tencent" });
    for (const item of node.ResourceList) {
      if (typeof item.ResourceId !== "string") continue;
      const extensions = Object.fromEntries((item.Extensions || []).map(e => [e.Name, e.Value || ""]));
      const region = source.NodeRegion || extensions.Region || extensions.Zone?.replace(/-\d+$/, "") || "";
      const key = `${productKey}:${region}:${item.ResourceId}`;
      const existing = resources.get(key);
      if (existing) {
        existing.nodeNames = [...new Set([...existing.nodeNames, source.NodeName])];
        existing.nodeIds = [...new Set([...existing.nodeIds, source.DiagramId].filter(Boolean))]; continue;
      }
      resources.set(key, { id: item.ResourceId, name: item.ResourceName || item.ResourceId, productKey, product, cloudProvider,
        region, zone: extensions.Zone || "", status: item.Status || "未知", nodeNames: [source.NodeName], nodeIds: [source.DiagramId].filter(Boolean),
        url: /^https:\/\/console\.cloud\.tencent\.com\//.test(item.ResourceUrl || "") ? item.ResourceUrl : "",
        privateIp: extensions.PrivateIpAddresses || extensions.Vip || "", publicIp: extensions.PublicIpAddresses || "" });
    }
  }
  const regions = new Map();
  for (const resource of resources.values()) {
    const product = products.get(resource.productKey);
    product.resourceCount++;
    if (resource.region && !product.regions.includes(resource.region)) product.regions.push(resource.region);
    const region = resource.region || "unknown";
    if (!regions.has(region)) regions.set(region, { id: region, resourceCount: 0, products: [] });
    const entry = regions.get(region); entry.resourceCount++;
    if (!entry.products.includes(resource.product)) entry.products.push(resource.product);
  }
  const diagramNodes = arch.NodeList.filter(node => node.DiagramId && node.ProductType !== "LINE").map(node => {
    const bindingNodeIds = new Set([node.DiagramId]);
    // Containers expose their descendants too. Guard malformed/cyclic parent chains.
    for (let pass = 0; pass < arch.NodeList.length; pass++) {
      let changed = false;
      for (const child of arch.NodeList) if (child.DiagramId && bindingNodeIds.has(child.ParentDiagramId) && !bindingNodeIds.has(child.DiagramId)) {
        bindingNodeIds.add(child.DiagramId); changed = true;
      }
      if (!changed) break;
    }
    const bound = [...resources.values()].filter(r => r.nodeIds.some(id => bindingNodeIds.has(id)));
    return { id: node.DiagramId, name: node.NodeName || node.ProductType || "未命名节点", product: node.ProductType || "",
      bindingNodeIds: [...bindingNodeIds], resourceKeys: bound.map(r => `${r.productKey}:${r.region}:${r.id}`), resourceCount: bound.length };
  });
  return { resources: [...resources.values()], products: [...products.values()], regions: [...regions.values()], nodes: diagramNodes };
}

async function getDetail(id) {
  const watch = watches.getWatch(id), credential = watches.credentialFor(watch.credentialId);
  const [description, resolved] = await Promise.all([
    watches.request(credential, "DescribeArch", { ArchId: watch.archId, Username: "cloudq-gateway" }),
    watches.request(credential, "DescribeArchResources", { ArchId: watch.archId }),
  ]);
  if (description.Arch?.ArchId !== watch.archId || resolved.ArchId !== watch.archId) throw new Error("Invalid architecture detail response");
  return { watch: { ...watch, archName: description.Arch.ArchName || watch.archName,
    versionName: description.Arch.VersionName || watch.versionName }, ...inventory(description.Arch, resolved), fetchedAt: Date.now() };
}

async function getOriginalDiagram(id, view = "3d") {
  if (!["2d", "3d"].includes(view)) throw new Error("Invalid 架构图视图，仅支持 2d 或 3d");
  const watch = watches.getWatch(id), credential = watches.credentialFor(watch.credentialId);
  const result = await watches.request(credential, "DescribeArchSvgData", { ArchId: watch.archId, IsThreeDimension: view === "3d" });
  if (result.ArchId !== watch.archId || typeof result.Svg !== "string" || !/<svg[\s>]/i.test(result.Svg) || result.Svg.length > 10 * 1024 * 1024) {
    throw new Error("Invalid 智能顾问原始架构图暂不可用，请前往腾讯云查看或保存原图后重试");
  }
  return { archId: watch.archId, view, svg: result.Svg, fetchedAt: Date.now() };
}

module.exports = { getDetail, inventory, getOriginalDiagram };
