import { conciseAlt } from "../../shared/altText";
import type { CardCarousel } from "../../shared/carousel";
export function cardAltTextState(asset:{id:number;sha256:string;carousel:CardCarousel|null},title:string){
 const pages=asset.carousel?.pages??[{id:asset.id,sha256:asset.sha256,title}];
 return {version:asset.carousel?.altVersion??0,values:pages.map(p=>p.altText||conciseAlt([p.title||title]))};
}
