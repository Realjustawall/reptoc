export const WORLD_TYPES = new Set(["node","map","pin","lore","artifact","power_system","timeline","timeline_event","relationship","tag","settings"]);
export const VISIBILITIES = new Set(["draft","published","private","unlisted"]);
export const PUBLICATION_STATUSES = new Set(["draft","published"]);
export const publicWorldbuildingCacheKey=(novelId:string,version:number,type="all")=>`app:v1:worldbuilding:novel:${novelId}:v${version}:${type}:published`;
export const previewWorldbuildingCacheKey=(novelId:string,version:number,userId:string,type="all")=>`app:v1:worldbuilding:novel:${novelId}:v${version}:${type}:preview:user:${userId}`;
export function ttlWithJitter(base:number,jitter=.15,random=Math.random){return Math.max(1,Math.round(base*(1+(random()*2-1)*jitter)));}

export function validateWorldbuildingInput(input:any,partial=false){
  const errors:Record<string,string>={};
  if(!partial&&!WORLD_TYPES.has(input.resourceType))errors.resourceType="Unsupported resource type";
  if(input.resourceType!==undefined&&!WORLD_TYPES.has(input.resourceType))errors.resourceType="Unsupported resource type";
  if(!partial&&!String(input.name||"").trim())errors.name="Name is required";
  if(input.name!==undefined&&(typeof input.name!=="string"||!input.name.trim()||input.name.trim().length>180))errors.name="Name must be 1–180 characters";
  if(input.description!==undefined&&String(input.description).length>100000)errors.description="Description is too long";
  if(input.data!==undefined&&JSON.stringify(input.data).length>1_000_000)errors.data="Resource details are too large";
  if(input.visibility!==undefined&&!VISIBILITIES.has(input.visibility))errors.visibility="Unsupported visibility";
  if(input.publicationStatus!==undefined&&!PUBLICATION_STATUSES.has(input.publicationStatus))errors.publicationStatus="Unsupported publication status";
  const related=input.data?.relatedIds;
  if(related!==undefined){
    if(!Array.isArray(related)||related.some((id:any)=>typeof id!=="string"||!id))errors["data.relatedIds"]="Related IDs must be non-empty strings";
    else if(new Set(related).size!==related.length)errors["data.relatedIds"]="Duplicate links are not allowed";
  }
  if(input.resourceType==="pin"){
    const x=Number(input.data?.x),y=Number(input.data?.y);
    if(!Number.isFinite(x)||x<0||x>1)errors["data.x"]="Pin X coordinate must be between 0 and 1";
    if(!Number.isFinite(y)||y<0||y>1)errors["data.y"]="Pin Y coordinate must be between 0 and 1";
  }
  if(input.resourceType==="relationship"){
    if(!input.data?.sourceId)errors["data.sourceId"]="Source is required";
    if(!input.data?.targetId)errors["data.targetId"]="Target is required";
    if(input.data?.sourceId===input.data?.targetId)errors["data.targetId"]="A relationship cannot target itself";
    if(!String(input.subtype||input.data?.relationshipType||"").trim())errors.subtype="Relationship type is required";
    if(!["directed","undirected"].includes(input.data?.direction||"directed"))errors["data.direction"]="Direction must be directed or undirected";
    const importance=Number(input.data?.importance??1);if(!Number.isFinite(importance)||importance<1||importance>10)errors["data.importance"]="Importance must be between 1 and 10";
  }
  if(input.resourceType==="timeline_event"||input.data?.startDate||input.data?.endDate){
    const start=input.data?.startDate?new Date(input.data.startDate):null,end=input.data?.endDate?new Date(input.data.endDate):null;
    if(start&&!Number.isFinite(start.getTime()))errors["data.startDate"]="Start date is invalid";
    if(end&&!Number.isFinite(end.getTime()))errors["data.endDate"]="End date is invalid";
    if(start&&end&&Number.isFinite(start.getTime())&&Number.isFinite(end.getTime())&&end<start)errors["data.endDate"]="End date cannot precede start date";
  }
  const levels=input.data?.progressionLevels;
  if(Array.isArray(levels)){const orders=levels.map((x:any,i:number)=>Number(x.order??i));if(new Set(orders).size!==orders.length)errors["data.progressionLevels"]="Progression level order values must be unique";}
  return errors;
}
export function referencedIds(input:any){const ids=new Set<string>();for(const id of input?.data?.relatedIds||[])if(typeof id==="string")ids.add(id);for(const key of ["sourceId","targetId","linkedResourceId","relatedLocationId"])if(typeof input?.data?.[key]==="string"&&input.data[key])ids.add(input.data[key]);return[...ids];}
