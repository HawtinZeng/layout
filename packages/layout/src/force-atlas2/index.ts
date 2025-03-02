import { Graph as GGraph } from '@antv/graphlib';
import { isFunction, isNumber, isObject } from '@antv/util';
import type {
  Edge,
  EdgeData,
  ForceAtlas2LayoutOptions,
  Graph,
  Layout,
  LayoutMapping,
  Node,
  OutEdge,
  OutEdgeData,
  OutNode,
  OutNodeData,
  PointTuple,
} from '../types';
import { cloneFormatData, isArray } from '../util';
import { handleSingleNodeGraph } from '../util/common';
import Body from './body';
import Quad from './quad';
import QuadTree from './quad-tree';

const DEFAULTS_LAYOUT_OPTIONS: Partial<ForceAtlas2LayoutOptions> = {
  center: [0, 0],
  width: 300,
  height: 300,
  kr: 5,
  kg: 1,
  mode: 'normal',
  preventOverlap: false,
  dissuadeHubs: false,
  maxIteration: 0,
  ks: 0.1,
  ksmax: 10,
  tao: 0.1,
};

interface FormattedOptions extends ForceAtlas2LayoutOptions {
  width: number;
  height: number;
  maxIteration: number;
  center: PointTuple;
  kr: number;
  kg: number;
  ks: number;
  ksmax: number;
  tao: number;
}
type ForceMap = {
  [id: string]: PointTuple;
};
type BodyMap = {
  [id: string]: Body;
};
type SizeMap = { [id: string]: number };
type CalcGraph = GGraph<OutNodeData, EdgeData>;

/**
 * <zh/> Atlas2 力导向布局
 * 
 * <en/> Force Atlas 2 layout
 */
export class ForceAtlas2Layout implements Layout<ForceAtlas2LayoutOptions> {
  id = 'forceAtlas2';

  constructor(
    public options: ForceAtlas2LayoutOptions = {} as ForceAtlas2LayoutOptions,
  ) {
    this.options = {
      ...DEFAULTS_LAYOUT_OPTIONS,
      ...options,
    };
  }

  /**
   * Return the positions of nodes and edges(if needed).
   */
  async execute(graph: Graph, options?: ForceAtlas2LayoutOptions) {
    return this.genericForceAtlas2Layout(false, graph, options);
  }
  /**
   * To directly assign the positions to the nodes.
   */
  async assign(graph: Graph, options?: ForceAtlas2LayoutOptions) {
   await this.genericForceAtlas2Layout(true, graph, options);
  }

  private async genericForceAtlas2Layout(
    assign: false,
    graph: Graph,
    options?: ForceAtlas2LayoutOptions,
  ): Promise<LayoutMapping>;
  private async genericForceAtlas2Layout(
    assign: true,
    graph: Graph,
    options?: ForceAtlas2LayoutOptions,
  ): Promise<void>;
  private async genericForceAtlas2Layout(
    assign: boolean,
    graph: Graph,
    options?: ForceAtlas2LayoutOptions,
  ): Promise<LayoutMapping | void> {
    const edges = graph.getAllEdges();
    const nodes = graph.getAllNodes();

    const mergedOptions = this.formatOptions(options, nodes.length);
    const { width, height, prune, maxIteration, nodeSize, center } =
      mergedOptions;

    if (!nodes?.length || nodes.length === 1) {
      return handleSingleNodeGraph(graph, assign, center);
    }

    const calcNodes = nodes.map(
      (node) => cloneFormatData(node, [width, height]) as OutNode,
    );
    const calcEdges = edges.filter((edge: Edge) => {
      const { source, target } = edge;
      return source !== target;
    }) as OutEdge[];
    const calcGraph = new GGraph<OutNodeData, OutEdgeData>({
      nodes: calcNodes,
      edges: calcEdges,
    });
    const sizes: SizeMap = this.getSizes(calcGraph, graph, nodeSize);

    this.run(calcGraph, graph, maxIteration, sizes, assign, mergedOptions);

    // if prune, place the leaves around their parents, and then re-layout for several iterations.
    if (prune) {
      for (let j = 0; j < calcEdges.length; j += 1) {
        const { source, target } = calcEdges[j];
        const sourceDegree = calcGraph.getDegree(source);
        const targetDegree = calcGraph.getDegree(source);
        if (sourceDegree <= 1) {
          const targetNode = calcGraph.getNode(target);
          calcGraph.mergeNodeData(source, {
            x: targetNode.data.x,
            y: targetNode.data.y,
          });
        } else if (targetDegree <= 1) {
          const sourceNode = calcGraph.getNode(source);
          calcGraph.mergeNodeData(target, {
            x: sourceNode.data.x,
            y: sourceNode.data.y,
          });
        }
      }
      const postOptions = {
        ...mergedOptions,
        prune: false,
        barnesHut: false,
      };
      this.run(calcGraph, graph, 100, sizes, assign, postOptions);
    }

    return {
      nodes: calcNodes,
      edges,
    };
  }

  /**
   * Init the node positions if there is no initial positions.
   * And pre-calculate the size (max of width and height) for each node.
   * @param calcGraph graph for calculation
   * @param graph origin graph
   * @param nodeSize node size config from layout options
   * @returns {SizeMap} node'id mapped to max of its width and height
   */
  private getSizes(
    calcGraph: CalcGraph,
    graph: Graph,
    nodeSize?: number | number[] | ((d?: Node) => number),
  ): SizeMap {
    const nodes = calcGraph.getAllNodes();
    const sizes: SizeMap = {};
    for (let i = 0; i < nodes.length; i += 1) {
      const { id, data } = nodes[i];
      sizes[id] = 10;
      if (isNumber(data.size)) {
        sizes[id] = data.size;
      } else if (isArray(data.size)) {
        if (!isNaN(data.size[0])) sizes[id] = Math.max(data.size[0]);
        if (!isNaN(data.size[1])) sizes[id] = Math.max(data.size[1]);
      } else if (isObject(data.size)) {
        // @ts-ignore
        sizes[id] = Math.max(data.size.width, data.size.height);
      } else if (isFunction(nodeSize)) {
        const originNode = graph.getNode(id);
        const size = nodeSize(originNode);
        if (isArray(size)) {
          sizes[id] = Math.max(...size);
        } else {
          sizes[id] = size;
        }
      } else if (isArray(nodeSize)) {
        sizes[id] = Math.max(...nodeSize);
      } else if (isNumber(nodeSize)) {
        sizes[id] = nodeSize;
      }
    }
    return sizes;
  }

  /**
   * Format the options.
   * @param options input options
   * @param nodeNum number of nodes
   * @returns formatted options
   */
  private formatOptions(
    options: ForceAtlas2LayoutOptions = {},
    nodeNum: number,
  ): FormattedOptions {
    const mergedOptions = { ...this.options, ...options } as FormattedOptions;
    const { center, width, height, barnesHut, prune, maxIteration, kr, kg } =
      mergedOptions;
    mergedOptions.width =
      !width && typeof window !== 'undefined' ? window.innerWidth : width;
    mergedOptions.height =
      !height && typeof window !== 'undefined' ? window.innerHeight : height;
    mergedOptions.center = !center
      ? [mergedOptions.width / 2, mergedOptions.height / 2]
      : center;

    if (barnesHut === undefined && nodeNum > 250) {
      mergedOptions.barnesHut = true;
    }
    if (prune === undefined && nodeNum > 100) mergedOptions.prune = true;
    if (maxIteration === 0 && !prune) {
      mergedOptions.maxIteration = 250;
      if (nodeNum <= 200 && nodeNum > 100) mergedOptions.maxIteration = 1000;
      else if (nodeNum > 200) mergedOptions.maxIteration = 1200;
    } else if (maxIteration === 0 && prune) {
      mergedOptions.maxIteration = 100;
      if (nodeNum <= 200 && nodeNum > 100) mergedOptions.maxIteration = 500;
      else if (nodeNum > 200) mergedOptions.maxIteration = 950;
    }

    if (!kr) {
      mergedOptions.kr = 50;
      if (nodeNum > 100 && nodeNum <= 500) mergedOptions.kr = 20;
      else if (nodeNum > 500) mergedOptions.kr = 1;
    }
    if (!kg) {
      mergedOptions.kg = 20;
      if (nodeNum > 100 && nodeNum <= 500) mergedOptions.kg = 10;
      else if (nodeNum > 500) mergedOptions.kg = 1;
    }

    return mergedOptions;
  }

  /**
   * Loops for fa2.
   * @param calcGraph graph for calculation
   * @param graph original graph
   * @param iteration iteration number
   * @param sizes nodes' size
   * @param options formatted layout options
   * @returns
   */
  private run(
    calcGraph: CalcGraph,
    graph: Graph,
    iteration: number,
    sizes: SizeMap,
    assign: boolean,
    options: FormattedOptions,
  ) {
    const { kr, barnesHut, onTick } = options;
    const calcNodes = calcGraph.getAllNodes();
    let sg = 0;
    let iter = iteration;
    const forces: ForceMap = {};
    const preForces: ForceMap = {};
    const bodies: BodyMap = {};

    for (let i = 0; i < calcNodes.length; i += 1) {
      const { data, id } = calcNodes[i];
      forces[id] = [0, 0];

      if (barnesHut) {
        const params = {
          id: i,
          rx: data.x,
          ry: data.y,
          mass: 1,
          g: kr,
          degree: calcGraph.getDegree(id),
        };
        bodies[id] = new Body(params);
      }
    }

    while (iter > 0) {
      sg = this.oneStep(
        calcGraph,
        {
          iter,
          preventOverlapIters: 50,
          krPrime: 100,
          sg,
          forces,
          preForces,
          bodies,
          sizes,
        },
        options,
      );
      iter--;
      onTick?.({
        nodes: calcNodes,
        edges: graph.getAllEdges(),
      });
      // if (assign) {
      //   calcNodes.forEach(({ id, data }) => graph.mergeNodeData(id, {
      //     x: data.x,
      //     y: data.y
      //   }))
      // }
    }

    return calcGraph;
  }

  /**
   * One step for a loop.
   * @param graph graph for calculation
   * @param params parameters for a loop
   * @param options formatted layout's input options
   * @returns
   */
  private oneStep(
    graph: CalcGraph,
    params: {
      iter: number;
      preventOverlapIters: number;
      krPrime: number;
      sg: number;
      forces: ForceMap;
      preForces: ForceMap;
      bodies: BodyMap;
      sizes: SizeMap;
    },
    options: FormattedOptions,
  ) {
    const { iter, preventOverlapIters, krPrime, sg, preForces, bodies, sizes } =
      params;
    let { forces } = params;
    const { preventOverlap, barnesHut } = options;
    const nodes = graph.getAllNodes();
    for (let i = 0; i < nodes.length; i += 1) {
      const { id } = nodes[i];
      preForces[id] = [...forces[id]];
      forces[id] = [0, 0];
    }
    // attractive forces, existing on every actual edge
    forces = this.getAttrForces(
      graph,
      iter,
      preventOverlapIters,
      sizes,
      forces,
      options,
    );

    // repulsive forces and Gravity, existing on every node pair
    // if preventOverlap, using the no-optimized method in the last preventOverlapIters instead.
    if (
      barnesHut &&
      ((preventOverlap && iter > preventOverlapIters) || !preventOverlap)
    ) {
      forces = this.getOptRepGraForces(graph, forces, bodies, options);
    } else {
      forces = this.getRepGraForces(
        graph,
        iter,
        preventOverlapIters,
        forces,
        krPrime,
        sizes,
        options,
      );
    }
    // update the positions
    return this.updatePos(graph, forces, preForces, sg, options);
  }

  /**
   * Calculate the attract forces for nodes.
   * @param graph graph for calculation
   * @param iter current iteration index
   * @param preventOverlapIters the iteration number for preventing overlappings
   * @param sizes nodes' sizes
   * @param forces forces for nodes, which will be modified
   * @param options formatted layout's input options
   * @returns
   */
  private getAttrForces(
    graph: CalcGraph,
    iter: number,
    preventOverlapIters: number,
    sizes: SizeMap,
    forces: ForceMap,
    options: FormattedOptions,
  ): ForceMap {
    const { preventOverlap, dissuadeHubs, mode, prune } = options;
    const edges = graph.getAllEdges();
    for (let i = 0; i < edges.length; i += 1) {
      const { source, target } = edges[i];
      const sourceNode = graph.getNode(source);
      const targetNode = graph.getNode(target);

      const sourceDegree = graph.getDegree(source);
      const targetDegree = graph.getDegree(target);
      if (prune && (sourceDegree <= 1 || targetDegree <= 1)) continue;

      const dir = [
        targetNode.data.x - sourceNode.data.x,
        targetNode.data.y - sourceNode.data.y,
      ];
      let eucliDis = Math.hypot(dir[0], dir[1]);
      eucliDis = eucliDis < 0.0001 ? 0.0001 : eucliDis;
      dir[0] = dir[0] / eucliDis;
      dir[1] = dir[1] / eucliDis;

      if (preventOverlap && iter < preventOverlapIters) {
        eucliDis = eucliDis - sizes[source] - sizes[target];
      }
      let fa1 = eucliDis;
      let fa2 = fa1;
      if (mode === 'linlog') {
        fa1 = Math.log(1 + eucliDis);
        fa2 = fa1;
      }
      if (dissuadeHubs) {
        fa1 = eucliDis / sourceDegree;
        fa2 = eucliDis / targetDegree;
      }
      if (preventOverlap && iter < preventOverlapIters && eucliDis <= 0) {
        fa1 = 0;
        fa2 = 0;
      } else if (preventOverlap && iter < preventOverlapIters && eucliDis > 0) {
        fa1 = eucliDis;
        fa2 = eucliDis;
      }
      forces[source][0] += fa1 * dir[0];
      forces[target][0] -= fa2 * dir[0];
      forces[source][1] += fa1 * dir[1];
      forces[target][1] -= fa2 * dir[1];
    }
    return forces;
  }

  /**
   * Calculate the repulsive forces for nodes under barnesHut mode.
   * @param graph graph for calculatiion
   * @param forces forces for nodes, which will be modified
   * @param bodies force body map
   * @param options formatted layout's input options
   * @returns
   */
  private getOptRepGraForces(
    graph: CalcGraph,
    forces: ForceMap,
    bodies: BodyMap,
    options: FormattedOptions,
  ) {
    const { kg, center, prune } = options;
    const nodes = graph.getAllNodes();
    const nodeNum = nodes.length;
    let minx = 9e10;
    let maxx = -9e10;
    let miny = 9e10;
    let maxy = -9e10;
    for (let i = 0; i < nodeNum; i += 1) {
      const { id, data } = nodes[i];
      if (prune && graph.getDegree(id) <= 1) continue;
      bodies[id].setPos(data.x, data.y);
      if (data.x >= maxx) maxx = data.x;
      if (data.x <= minx) minx = data.x;
      if (data.y >= maxy) maxy = data.y;
      if (data.y <= miny) miny = data.y;
    }

    const width = Math.max(maxx - minx, maxy - miny);

    const quadParams = {
      xmid: (maxx + minx) / 2,
      ymid: (maxy + miny) / 2,
      length: width,
      massCenter: center,
      mass: nodeNum,
    };
    const quad = new Quad(quadParams);
    const quadTree = new QuadTree(quad);

    // build the tree, insert the nodes(quads) into the tree
    for (let i = 0; i < nodeNum; i += 1) {
      const { id } = nodes[i];
      if (prune && graph.getDegree(id) <= 1) continue;

      if (bodies[id].in(quad)) quadTree.insert(bodies[id]);
    }
    // update the repulsive forces and the gravity.
    for (let i = 0; i < nodeNum; i += 1) {
      const { id, data } = nodes[i];
      const degree = graph.getDegree(id);
      if (prune && degree <= 1) continue;

      bodies[id].resetForce();
      quadTree.updateForce(bodies[id]);
      forces[id][0] -= bodies[id].fx;
      forces[id][1] -= bodies[id].fy;

      // gravity
      const dir = [data.x - center[0], data.y - center[1]];
      let eucliDis = Math.hypot(dir[0], dir[1]);
      eucliDis = eucliDis < 0.0001 ? 0.0001 : eucliDis;
      dir[0] = dir[0] / eucliDis;
      dir[1] = dir[1] / eucliDis;
      const fg = kg * (degree + 1); // tslint:disable-line
      forces[id][0] -= fg * dir[0];
      forces[id][1] -= fg * dir[1];
    }
    return forces;
  }

  /**
   * Calculate the repulsive forces for nodes.
   * @param graph graph for calculatiion
   * @param iter current iteration index
   * @param preventOverlapIters the iteration number for preventing overlappings
   * @param forces forces for nodes, which will be modified
   * @param krPrime larger the krPrime, larger the repulsive force
   * @param sizes nodes' sizes
   * @param options formatted layout's input options
   * @returns
   */
  private getRepGraForces(
    graph: CalcGraph,
    iter: number,
    preventOverlapIters: number,
    forces: ForceMap,
    krPrime: number,
    sizes: SizeMap,
    options: FormattedOptions,
  ): ForceMap {
    const { preventOverlap, kr, kg, center, prune } = options;
    const nodes = graph.getAllNodes();
    const nodeNum = nodes.length;
    for (let i = 0; i < nodeNum; i += 1) {
      const nodei = nodes[i];
      const degreei = graph.getDegree(nodei.id);
      for (let j = i + 1; j < nodeNum; j += 1) {
        const nodej = nodes[j];
        const degreej = graph.getDegree(nodej.id);

        if (prune && (degreei <= 1 || degreej <= 1)) continue;

        const dir = [nodej.data.x - nodei.data.x, nodej.data.y - nodei.data.y];
        let eucliDis = Math.hypot(dir[0], dir[1]);
        eucliDis = eucliDis < 0.0001 ? 0.0001 : eucliDis;
        dir[0] = dir[0] / eucliDis;
        dir[1] = dir[1] / eucliDis;

        if (preventOverlap && iter < preventOverlapIters) {
          eucliDis = eucliDis - sizes[nodei.id] - sizes[nodej.id];
        }

        let fr = (kr * (degreei + 1) * (degreej + 1)) / eucliDis;

        if (preventOverlap && iter < preventOverlapIters && eucliDis < 0) {
          fr = krPrime * (degreei + 1) * (degreej + 1);
        } else if (
          preventOverlap &&
          iter < preventOverlapIters &&
          eucliDis === 0
        ) {
          fr = 0;
        } else if (
          preventOverlap &&
          iter < preventOverlapIters &&
          eucliDis > 0
        ) {
          fr = (kr * (degreei + 1) * (degreej + 1)) / eucliDis;
        }
        forces[nodei.id][0] -= fr * dir[0];
        forces[nodej.id][0] += fr * dir[0];
        forces[nodei.id][1] -= fr * dir[1];
        forces[nodej.id][1] += fr * dir[1];
      }

      // gravity
      const dir = [nodei.data.x - center[0], nodei.data.y - center[1]];
      const eucliDis = Math.hypot(dir[0], dir[1]);
      dir[0] = dir[0] / eucliDis;
      dir[1] = dir[1] / eucliDis;
      const fg = kg * (degreei + 1); // tslint:disable-line
      forces[nodei.id][0] -= fg * dir[0];
      forces[nodei.id][1] -= fg * dir[1];
    }
    return forces;
  }

  /**
   * Update node positions.
   * @param graph graph for calculatiion
   * @param forces forces for nodes, which will be modified
   * @param preForces previous forces for nodes, which will be modified
   * @param sg constant for move distance of one step
   * @param options formatted layout's input options
   * @returns
   */
  private updatePos(
    graph: CalcGraph,
    forces: ForceMap,
    preForces: ForceMap,
    sg: number,
    options: FormattedOptions,
  ): number {
    const { ks, tao, prune, ksmax } = options;
    const nodes = graph.getAllNodes();
    const nodeNum = nodes.length;
    const swgns = [];
    const trans = [];
    // swg(G) and tra(G)
    let swgG = 0;
    let traG = 0;
    let usingSg = sg;
    for (let i = 0; i < nodeNum; i += 1) {
      const { id } = nodes[i];
      const degree = graph.getDegree(id);
      if (prune && degree <= 1) continue;

      const minus = [
        forces[id][0] - preForces[id][0],
        forces[id][1] - preForces[id][1],
      ];
      const minusNorm = Math.hypot(minus[0], minus[1]);
      const add = [
        forces[id][0] + preForces[id][0],
        forces[id][1] + preForces[id][1],
      ];
      const addNorm = Math.hypot(add[0], add[1]);

      swgns[i] = minusNorm;
      trans[i] = addNorm / 2;

      swgG += (degree + 1) * swgns[i];
      traG += (degree + 1) * trans[i];
    }

    const preSG = usingSg;
    usingSg = (tao * traG) / swgG;
    if (preSG !== 0) {
      usingSg = usingSg > 1.5 * preSG ? 1.5 * preSG : usingSg;
    }
    // update the node positions
    for (let i = 0; i < nodeNum; i += 1) {
      const { id, data } = nodes[i];
      const degree = graph.getDegree(id);
      if (prune && degree <= 1) continue;
      if (isNumber(data.fx) && isNumber(data.fy)) continue;

      let sn = (ks * usingSg) / (1 + usingSg * Math.sqrt(swgns[i]));
      let absForce = Math.hypot(forces[id][0], forces[id][1]);
      absForce = absForce < 0.0001 ? 0.0001 : absForce;
      const max = ksmax / absForce;
      sn = sn > max ? max : sn;
      const dnx = sn * forces[id][0];
      const dny = sn * forces[id][1];
      graph.mergeNodeData(id, {
        x: data.x + dnx,
        y: data.y + dny,
      });
    }
    return usingSg;
  }
}
