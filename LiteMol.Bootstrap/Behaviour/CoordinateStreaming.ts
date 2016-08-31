/*
 * Copyright (c) 2016 David Sehnal, licensed under Apache 2.0, See LICENSE file for more info.
 */


namespace LiteMol.Bootstrap.Behaviour.Molecule {
    "use strict";
    
    
    import Query = Core.Structure.Query;
    import Transforms = Entity.Transformer;
    
    export class CoordinateStreaming implements Dynamic {
        
        private obs: Rx.IDisposable[] = [];  
        private target: Entity.Molecule.Model = void 0; 
        private behaviour: Entity.Molecule.CoordinateStreaming.Behaviour = void 0;
        private currentRequest: Core.Computation<string> = void 0;
        private ref: string = Utils.generateUUID();
        private download: Task.Running<string> = void 0;
        private cache = new CoordinateStreaming.Cache(100);
        
        server: string;
        
        private remove() {
            if (this.download) {
                this.download.discard();
                this.download = void 0;
            }
            Command.Tree.RemoveNode.dispatch(this.context, this.ref);
        }
                
        private isApplicable(info: Interactivity.Info) {
            if (!Interactivity.Molecule.isMoleculeModelInteractivity(info)) return;
            let e = info.entity;
            while (e.parent !== e) {
                if (e === this.target) return true;
                e = e.parent;
            }
            return false;
        }
           
        private style: Visualization.Molecule.Style<Visualization.Molecule.BallsAndSticksParams> = {
            type: 'BallsAndSticks',
            computeOnBackground: true,
            params: { useVDW: true, vdwScaling: 0.17, bondRadius: 0.07, detail: 'Automatic' },
            theme: { template: Visualization.Molecule.Default.ElementSymbolThemeTemplate, colors: Visualization.Molecule.Default.ElementSymbolThemeTemplate.colors, transparency: { alpha: 1.0 } },
            isNotSelectable: true
        }      
        
        private update(info: Interactivity.Info) {
            this.remove();
            if (!this.isApplicable(info)) {
                return;
            }
            
            let model = Utils.Molecule.findModel(info.entity).props.model;
            
            let i = model.atoms.residueIndex[info.elements[0]];
            let rs = model.residues;
            
            let authAsymId = rs.authAsymId[i];
            let transform: number[] = void 0;
            
            if (model.source === Core.Structure.MoleculeModelSource.Computed) {
                let p = model.parent;
                let cI = rs.chainIndex[i];
                let chain = model.chains.sourceChainIndex[cI];
                authAsymId = p.chains.authAsymId[chain];
                transform = model.operators[model.chains.operatorIndex[cI]].matrix;
            }            
            
            let url = 
                `${this.server}/`
                + `${model.id.toLocaleLowerCase()}/ambientResidues?`
                + `modelId=${encodeURIComponent(model.modelId)}&`
                + `entityId=${encodeURIComponent(rs.entityId[i])}&`
                + `authAsymId=${encodeURIComponent(authAsymId)}&`
                + `authSeqNumber=${encodeURIComponent(''+rs.authSeqNumber[i])}&`
                + `insCode=${encodeURIComponent(rs.insCode[i] !== null ? rs.insCode[i] : '')}&`
                + `radius=${encodeURIComponent(''+this.radius)}&`
                + `atomSitesOnly=1`;
             
            this.download = Utils.ajaxGetString(url).run(this.context);
                       
            let cached = this.cache.get(url); 
            if (cached) {
                this.create(cached, transform);
            } else {                        
                this.context.performance.start(this.ref);
                this.download.then(data => {            
                    this.cache.add(url, data);
                    this.context.performance.end(this.ref);
                    this.context.logger.info(`Streaming done in ${this.context.performance.formatTime(this.ref)}`);
                    this.create(data, transform);
                }).catch(() => { this.context.performance.end(this.ref); });
            }
            
        }  
        
        private create(data: string, transform: number[]) {
            let action = Tree.Transform.build().add(this.behaviour, Entity.Transformer.Molecule.CoordinateStreaming.CreateModel, { data, transform }, { ref: this.ref, isHidden: true })
                    .then(<Bootstrap.Tree.Transformer.To<Entity.Molecule.Visual>>Transforms.Molecule.CreateVisual, { style: this.style });
            Tree.Transform.apply(this.context, action).run(this.context);
        }
          
        dispose() {
            this.remove();
            for (let o of this.obs) o.dispose();
            this.obs = [];
        }
                
        register(behaviour: Entity.Molecule.CoordinateStreaming.Behaviour) {
            this.behaviour = behaviour;
            this.target = <any>behaviour.parent;
            this.obs.push(this.context.behaviours.select.subscribe(e => this.update(e))); 
        }
        
        constructor(public context: Context, server: string, public radius = 5) {
            this.server = CoordinateStreaming.normalizeServerName(server);
        }
    }   
    
    export namespace CoordinateStreaming {
        
        export function normalizeServerName(s: string) {
            if (s[s.length - 1] !== '/') return s;
            if (s.length > 0) return s.substr(0, s.length - 1);
            return s;
        }
        
        export function getBaseUrl(id: string, server: string) {
            return `${normalizeServerName(server)}/${id.trim().toLocaleLowerCase()}/cartoon`; 
        }
        
        export class CacheEntry implements Utils.LinkedElement<CacheEntry> {
            previous: CacheEntry = void 0; 
            next: CacheEntry = void 0; 
            inList: boolean; 
            
            constructor(public key: string, public data: string) {
                
            }
        }
        
        export class Cache {
            
            private count = 0;
            entries = new Utils.LinkedList<CacheEntry>();
            
            get(key: string) {
                for (let e = this.entries.first; e; e = e.next) {
                    if (e.key === key) return e.data;
                }
                return void 0;
            }
            
            add(key: string, data: string): string {
                if (this.count > this.size) {
                    this.entries.remove(this.entries.first);
                }
                let e = new CacheEntry(key, data);
                this.entries.addLast(e);
                return data;
            }
            
            constructor(public size: number) {
                if (size < 1) size = 1;
            }            
        }
        
    }
}