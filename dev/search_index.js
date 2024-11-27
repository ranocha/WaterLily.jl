var documenterSearchIndex = {"docs":
[{"location":"#WaterLily","page":"WaterLily","title":"WaterLily","text":"","category":"section"},{"location":"#Introduction-and-Quickstart","page":"WaterLily","title":"Introduction and Quickstart","text":"","category":"section"},{"location":"","page":"WaterLily","title":"WaterLily","text":"WaterLily","category":"page"},{"location":"#WaterLily","page":"WaterLily","title":"WaterLily","text":"WaterLily.jl\n\n(Image: Dev) (Image: Examples) (Image: CI) (Image: codecov)\n\n(Image: Julia flow)\n\nOverview\n\nWaterLily.jl is a simple and fast fluid simulator written in pure Julia. This project is supported by awesome libraries developed within the Julia scientific community, and it aims to accelerate and enhance fluid simulations. Watch the JuliaCon2024 talk here:\n\n(Image: JuliaCon2024 still and link)\n\nIf you have used WaterLily for research, please cite us! The 2024 paper describes the main features of the solver and provides benchmarking, validation, and profiling results.\n\n@misc{WeymouthFont2024,\n    title         = {WaterLily.jl: A differentiable and backend-agnostic Julia solver to simulate incompressible viscous flow and dynamic bodies},\n    author        = {Gabriel D. Weymouth and Bernat Font},\n    url           = {https://arxiv.org/abs/2407.16032},\n    eprint        = {2407.16032},\n    archivePrefix = {arXiv},\n    year          = {2024},\n    primaryClass  = {physics.flu-dyn}\n}\n\nMethod/capabilities\n\nWaterLily solves the unsteady incompressible 2D or 3D Navier-Stokes equations on a Cartesian grid. The pressure Poisson equation is solved with a geometric multigrid method. Solid boundaries are modelled using the Boundary Data Immersion Method. The solver can run on serial CPU, multi-threaded CPU, or GPU backends.\n\nExample: Flow over a circle\n\nWaterLily lets the user can set the domain size and boundary conditions, the fluid viscosity (which determines the Reynolds number), and immerse solid obstacles. A large selection of examples, notebooks, and tutorials are found in the WaterLily-Examples repository. Here, we will illustrate the basics by simulating and plotting the flow over a circle.\n\nWe define the size of the simulation domain as n by m cells. The circle has radius m/8 and is centered at (m/2,m/2). The flow boundary conditions are (U,0), where we set U=1, and the Reynolds number is Re=U*radius/ν where ν (Greek \"nu\" U+03BD, not Latin lowercase \"v\") is the kinematic viscosity of the fluid.\n\nusing WaterLily\nfunction circle(n,m;Re=100,U=1)\n    # signed distance function to circle\n    radius, center = m/8, m/2-1\n    sdf(x,t) = √sum(abs2, x .- center) - radius\n\n    Simulation((n,m),   # domain size\n               (U,0),   # domain velocity (& velocity scale)\n               2radius; # length scale\n               ν=U*2radius/Re,     # fluid viscosity\n               body=AutoBody(sdf)) # geometry\nend\n\nThe circle geometry is defined using a signed distance function. The AutoBody function uses automatic differentiation to infer the other geometric parameters of the body automatically. Replace the circle's distance function with any other, and now you have the flow around something else... such as a donut or the Julia logo. For more complex geometries, ParametricBodies.jl defines a body using any parametric curve, such as a spline. See that repo (and the video above) for examples.\n\nThe code block above return a Simulation with the parameters we've defined. Now we can initialize a simulation (first line) and step it forward in time (second line)\n\ncirc = circle(3*2^5,2^6)\nsim_step!(circ)\n\nNote we've set n,m to be multiples of powers of 2, which is important when using the (very fast) geometric multi-grid solver.\n\nWe can now access and plot whatever variables we like. For example, we can plot the x-component of the velocity field using\n\nusing Plots\nu = circ.flow.u[:,:,1] # first component is x\ncontourf(u') # transpose the array for the plot\n\n(Image: Initial velocity field)\n\nAs you can see, the velocity within the circle is zero, the velocity far from the circle is one, and there are accelerated and decelerated regions around the circle. The sim_step! has only taken a single time step, and this initial flow around our circle looks similar to the potential flow because the viscous boundary layer has not separated yet.\n\nA set of flow metric functions have been implemented, and we can use them to measure the simulation. The following code block defines a function to step the simulation to time t and then use the pressure_force metric to measure the force on the immersed body. The function is applied over a time range, and the forces are plotted.\n\nfunction get_forces!(sim,t)\n    sim_step!(sim,t,remeasure=false)\n    force = WaterLily.pressure_force(sim)\n    force./(0.5sim.L*sim.U^2) # scale the forces!\nend\n\n# Simulate through the time range and get forces\ntime = 1:0.1:50 # time scale is sim.L/sim.U\nforces = [get_forces!(circ,t) for t in time];\n\n#Plot it\nplot(time,[first.(forces), last.(forces)],\n    labels=permutedims([\"drag\",\"lift\"]),\n    xlabel=\"tU/L\",\n    ylabel=\"Pressure force coefficients\")\n\n(Image: Pressure forces)\n\nWe can also plot the vorticity field instead of the u-velocity to see a snap-shot of the wake.\n\n# Use curl(velocity) to compute vorticity `inside` the domain\nω = zeros(size(u));\n@inside ω[I] = WaterLily.curl(3,I,circ.flow.u)*circ.L/circ.U\n\n# Plot it\nclims = (-6,6)\ncontourf(clamp.(ω,clims...)'; clims,\n    color=palette(:RdBu,9),linewidth=0,levels=8,\n    aspect_ratio=:equal,border=:none)\n\n(Image: Vorticity field)\n\nAs you can see, WaterLily correctly predicts that the flow is unsteady, with an alternating vortex street wake, leading to an oscillating side force and drag force.\n\nMulti-threading and GPU backends\n\nWaterLily uses KernelAbstractions.jl to multi-thread on CPU and run on GPU backends. The implementation method and speed-up are documented in the 2024 paper, with costs as low as 1.44 nano-seconds measured per degree of freedom and time step!\n\nNote that multi-threading requires starting Julia with the --threads argument, see the multi-threading section of the manual. If you are running Julia with multiple threads, KernelAbstractions will detect this and multi-thread the loops automatically.\n\nRunning on a GPU requires initializing the Simulation memory on the GPU, and care needs to be taken to move the data back to the CPU for visualization. As an example, let's compare a 3D GPU simulation of a sphere to the 2D multi-threaded CPU circle defined above\n\nusing CUDA,WaterLily\nfunction sphere(n,m;Re=100,U=1,T=Float64,mem=Array)\n    radius, center = m/8, m/2-1\n    body = AutoBody((x,t)->√sum(abs2, x .- center) - radius)\n    Simulation((n,m,m),(U,0,0), # 3D array size and BCs\n                2radius;ν=U*2radius/Re,body, # no change\n                T,   # Floating point type\n                mem) # memory type\nend\n\n@assert CUDA.functional()      # is your CUDA GPU working??\nGPUsim = sphere(3*2^5,2^6;T=Float32,mem=CuArray); # 3D GPU sim!\nprintln(length(GPUsim.flow.u)) # 1.3M degrees-of freedom!\nsim_step!(GPUsim)              # compile GPU code & run one step\n@time sim_step!(GPUsim,50,remeasure=false) # 40s!!\n\nCPUsim = circle(3*2^5,2^6);    # 2D CPU sim\nprintln(length(CPUsim.flow.u)) # 0.013M degrees-of freedom!\nsim_step!(CPUsim)              # compile GPU code & run one step\nprintln(Threads.nthreads())    # I'm using 8 threads\n@time sim_step!(CPUsim,50,remeasure=false) # 28s!!\n\nAs you can see, the 3D sphere set-up is almost identical to the 2D circle, but using 3D arrays means there are almost 1.3M degrees-of-freedom, 100x bigger than in 2D. Never the less, the simulation is quite fast on the GPU, only around 40% slower than the much smaller 2D simulation on a CPU with 8 threads. See the 2024 paper and the examples repo for many more non-trivial examples including running on AMD GPUs.\n\nFinally, KernelAbstractions does incur some CPU allocations for every loop, but other than this sim_step! is completely non-allocating. This is one reason why the speed-up improves as the size of the simulation increases.\n\nContributing and issues\n\nWe always appreciate new contributions, so please submit a pull request with your changes and help us make WaterLily even better! Note that contributions need to be submitted together with benchmark results - WaterLily should always be fast! 😃 For this, we have a fully automated benchmarking suite that conducts performance tests. In short, to compare your changes with the latest WaterLily, clone the that repo and run the benchmarks with\n\ngit clone https://github.com/WaterLily-jl/WaterLily-Benchmarks && cd WaterLily-Benchmarks\nsh benchmark.sh -wd \"<your/waterlily/path>\" -w \"<your_waterlily_branch> master\"\njulia --project compare.jl\n\nThis will run benchmarks for CPU and GPU backends. If you do not have a GPU, simply pass -b \"Array\" when runnning benchmark.sh. More information on the benchmark suite is available in that README.\n\nOf course, ideas, suggestions, and questions are welcome too! Please raise an issue to address any of these.\n\nDevelopment goals\n\nImmerse obstacles defined by 3D meshes (Meshing.jl)\nMulti-CPU/GPU simulations (https://github.com/WaterLily-jl/WaterLily.jl/pull/141)\nFree-surface physics with (Volume-of-Fluid) or other methods.\n\n\n\n\n\n","category":"module"},{"location":"#Types-Methods-and-Functions","page":"WaterLily","title":"Types Methods and Functions","text":"","category":"section"},{"location":"","page":"WaterLily","title":"WaterLily","text":"CurrentModule = WaterLily","category":"page"},{"location":"","page":"WaterLily","title":"WaterLily","text":"","category":"page"},{"location":"","page":"WaterLily","title":"WaterLily","text":"Modules = [WaterLily]\nOrder   = [:constant, :type, :function, :macro]","category":"page"},{"location":"#WaterLily.AbstractBody","page":"WaterLily","title":"WaterLily.AbstractBody","text":"AbstractBody\n\nImmersed body Abstract Type. Any AbstractBody subtype must implement\n\nd = sdf(body::AbstractBody, x, t=0)\n\nand\n\nd,n,V = measure(body::AbstractBody, x, t=0, fastd²=Inf)\n\nwhere d is the signed distance from x to the body at time t, and n & V are the normal and velocity vectors implied at x. A fast-approximate method can return ≈d,zero(x),zero(x) if d^2>fastd².\n\n\n\n\n\n","category":"type"},{"location":"#WaterLily.AbstractPoisson","page":"WaterLily","title":"WaterLily.AbstractPoisson","text":"Poisson{N,M}\n\nComposite type for conservative variable coefficient Poisson equations:\n\n∮ds β ∂x/∂n = σ\n\nThe resulting linear system is\n\nAx = [L+D+L']x = z\n\nwhere A is symmetric, block-tridiagonal and extremely sparse. Moreover,  D[I]=-∑ᵢ(L[I,i]+L'[I,i]). This means matrix storage, multiplication, ect can be easily implemented and optimized without external libraries.\n\nTo help iteratively solve the system above, the Poisson structure holds helper arrays for inv(D), the error ϵ, and residual r=z-Ax. An iterative solution method then estimates the error ϵ=̃A⁻¹r and increments x+=ϵ, r-=Aϵ.\n\n\n\n\n\n","category":"type"},{"location":"#WaterLily.AutoBody","page":"WaterLily","title":"WaterLily.AutoBody","text":"AutoBody(sdf,map=(x,t)->x; compose=true) <: AbstractBody\n\nsdf(x::AbstractVector,t::Real)::Real: signed distance function\nmap(x::AbstractVector,t::Real)::AbstractVector: coordinate mapping function\ncompose::Bool=true: Flag for composing sdf=sdf∘map\n\nImplicitly define a geometry by its sdf and optional coordinate map. Note: the map is composed automatically if compose=true, i.e. sdf(x,t) = sdf(map(x,t),t). Both parameters remain independent otherwise. It can be particularly heplful to set compose=false when adding mulitple bodies together to create a more complex one.\n\n\n\n\n\n","category":"type"},{"location":"#WaterLily.Bodies","page":"WaterLily","title":"WaterLily.Bodies","text":"Bodies(bodies, ops::AbstractVector)\n\nbodies::Vector{AutoBody}: Vector of AutoBody\nops::Vector{Function}: Vector of operators for the superposition of multiple AutoBodys\n\nSuperposes multiple body::AutoBody objects together according to the operators ops. While this can be manually performed by the operators implemented for AutoBody, adding too many bodies can yield a recursion problem of the sdf and map functions not fitting in the stack. This type implements the superposition of bodies by iteration instead of recursion, and the reduction of the sdf and map functions is done on the mesure function, and not before. The operators vector ops specifies the operation to call between two consecutive AutoBodys in the bodies vector. Note that + (or the alias ∪) is the only operation supported between Bodies.\n\n\n\n\n\n","category":"type"},{"location":"#WaterLily.Flow","page":"WaterLily","title":"WaterLily.Flow","text":"Flow{D::Int, T::Float, Sf<:AbstractArray{T,D}, Vf<:AbstractArray{T,D+1}, Tf<:AbstractArray{T,D+2}}\n\nComposite type for a multidimensional immersed boundary flow simulation.\n\nFlow solves the unsteady incompressible Navier-Stokes equations on a Cartesian grid. Solid boundaries are modelled using the Boundary Data Immersion Method. The primary variables are the scalar pressure p (an array of dimension D) and the velocity vector field u (an array of dimension D+1).\n\n\n\n\n\n","category":"type"},{"location":"#WaterLily.MultiLevelPoisson","page":"WaterLily","title":"WaterLily.MultiLevelPoisson","text":"MultiLevelPoisson{N,M}\n\nComposite type used to solve the pressure Poisson equation with a geometric multigrid method. The only variable is levels, a vector of nested Poisson systems.\n\n\n\n\n\n","category":"type"},{"location":"#WaterLily.NoBody","page":"WaterLily","title":"WaterLily.NoBody","text":"NoBody\n\nUse for a simulation without a body.\n\n\n\n\n\n","category":"type"},{"location":"#WaterLily.Simulation","page":"WaterLily","title":"WaterLily.Simulation","text":"Simulation(dims::NTuple, u_BC::Union{NTuple,Function}, L::Number;\n           U=norm2(u_BC), Δt=0.25, ν=0., ϵ=1, perdir=()\n           uλ::nothing, g=nothing, exitBC=false,\n           body::AbstractBody=NoBody(),\n           T=Float32, mem=Array)\n\nConstructor for a WaterLily.jl simulation:\n\ndims: Simulation domain dimensions.\nu_BC: Simulation domain velocity boundary conditions, either a         tuple u_BC[i]=uᵢ, i=eachindex(dims), or a time-varying function f(i,t)\nL: Simulation length scale.\nU: Simulation velocity scale.\nΔt: Initial time step.\nν: Scaled viscosity (Re=UL/ν).\ng: Domain acceleration, g(i,t)=duᵢ/dt\nϵ: BDIM kernel width.\nperdir: Domain periodic boundary condition in the (i,) direction.\nexitBC: Convective exit boundary condition in the i=1 direction.\nuλ: Function to generate the initial velocity field.\nbody: Immersed geometry.\nT: Array element type.\nmem: memory location. Array, CuArray, ROCm to run on CPU, NVIDIA, or AMD devices, respectively.\n\nSee files in examples folder for examples.\n\n\n\n\n\n","category":"type"},{"location":"#WaterLily.BC!","page":"WaterLily","title":"WaterLily.BC!","text":"BC!(a,A)\n\nApply boundary conditions to the ghost cells of a vector field. A Dirichlet condition a[I,i]=A[i] is applied to the vector component normal to the domain boundary. For example aₓ(x)=Aₓ ∀ x ∈ minmax(X). A zero Neumann condition is applied to the tangential components.\n\n\n\n\n\n","category":"function"},{"location":"#WaterLily.BCTuple","page":"WaterLily","title":"WaterLily.BCTuple","text":"BCTuple(U,dt,N)\n\nReturn BC tuple U(i∈1:N, t=sum(dt)).\n\n\n\n\n\n","category":"function"},{"location":"#WaterLily.CIj-Union{Tuple{d}, Tuple{Any, CartesianIndex{d}, Any}} where d","page":"WaterLily","title":"WaterLily.CIj","text":"CIj(j,I,jj)\n\nReplace jᵗʰ component of CartesianIndex with k\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.Jacobi!-Tuple{Any}","page":"WaterLily","title":"WaterLily.Jacobi!","text":"Jacobi!(p::Poisson; it=1)\n\nJacobi smoother run it times.  Note: This runs for general backends, but is very slow to converge.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.L₂-Tuple{Any}","page":"WaterLily","title":"WaterLily.L₂","text":"L₂(a)\n\nL₂ norm of array a excluding ghosts.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.accelerate!","page":"WaterLily","title":"WaterLily.accelerate!","text":"accelerate!(r,dt,g)\n\nAdd a uniform acceleration gᵢ+dUᵢ/dt at time t=sum(dt) to field r.\n\n\n\n\n\n","category":"function"},{"location":"#WaterLily.apply!-Tuple{Any, Any}","page":"WaterLily","title":"WaterLily.apply!","text":"apply!(f, c)\n\nApply a vector function f(i,x) to the faces of a uniform staggered array c or a function f(x) to the center of a uniform array c.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.check_nthreads-Tuple{Val{1}}","page":"WaterLily","title":"WaterLily.check_nthreads","text":"check_nthreads(::Val{1})\n\nCheck the number of threads available for the Julia session that loads WaterLily. A warning is shown when running in serial (JULIANUMTHREADS=1).\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.curl-Tuple{Any, Any, Any}","page":"WaterLily","title":"WaterLily.curl","text":"curl(i,I,u)\n\nCompute component i of 𝐮 at the edge of cell I. For example curl(3,CartesianIndex(2,2,2),u) will compute ω₃(x=1.5,y=1.5,z=2) as this edge produces the highest accuracy for this mix of cross derivatives on a staggered grid.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.curvature-Tuple{AbstractMatrix}","page":"WaterLily","title":"WaterLily.curvature","text":"curvature(A::AbstractMatrix)\n\nReturn H,K the mean and Gaussian curvature from A=hessian(sdf). K=tr(minor(A)) in 3D and K=0 in 2D.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.exitBC!-NTuple{4, Any}","page":"WaterLily","title":"WaterLily.exitBC!","text":"exitBC!(u,u⁰,U,Δt)\n\nApply a 1D convection scheme to fill the ghost cell on the exit of the domain.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.inside-Tuple{AbstractArray}","page":"WaterLily","title":"WaterLily.inside","text":"inside(a)\n\nReturn CartesianIndices range excluding a single layer of cells on all boundaries.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.inside_u-Union{Tuple{N}, Tuple{NTuple{N, T} where T, Any}} where N","page":"WaterLily","title":"WaterLily.inside_u","text":"inside_u(dims,j)\n\nReturn CartesianIndices range excluding the ghost-cells on the boundaries of a vector array on face j with size dims.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.interp-Union{Tuple{T}, Tuple{D}, Tuple{StaticArraysCore.SVector{D}, AbstractArray{T, D}}} where {D, T}","page":"WaterLily","title":"WaterLily.interp","text":"interp(x::SVector, arr::AbstractArray)\n\nLinear interpolation from array `arr` at index-coordinate `x`.\nNote: This routine works for any number of dimensions.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.ke-Union{Tuple{m}, Tuple{CartesianIndex{m}, Any}, Tuple{CartesianIndex{m}, Any, Any}} where m","page":"WaterLily","title":"WaterLily.ke","text":"ke(I::CartesianIndex,u,U=0)\n\nCompute ½𝐮-𝐔² at center of cell I where U can be used to subtract a background flow (by default, U=0).\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.loc-Union{Tuple{N}, Tuple{Any, CartesianIndex{N}}, Tuple{Any, CartesianIndex{N}, Any}} where N","page":"WaterLily","title":"WaterLily.loc","text":"loc(i,I) = loc(Ii)\n\nLocation in space of the cell at CartesianIndex I at face i. Using i=0 returns the cell center s.t. loc = I.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.logger","page":"WaterLily","title":"WaterLily.logger","text":"logger(fname=\"WaterLily\")\n\nSet up a logger to write the pressure solver data to a logging file named WaterLily.log.\n\n\n\n\n\n","category":"function"},{"location":"#WaterLily.measure!","page":"WaterLily","title":"WaterLily.measure!","text":"measure!(sim::Simulation,t=timeNext(sim))\n\nMeasure a dynamic body to update the flow and pois coefficients.\n\n\n\n\n\n","category":"function"},{"location":"#WaterLily.measure!-Union{Tuple{T}, Tuple{N}, Tuple{Flow{N, T, Sf, Vf, Tf} where {Sf<:(AbstractArray{T}), Vf<:(AbstractArray{T}), Tf<:(AbstractArray{T})}, AbstractBody}} where {N, T}","page":"WaterLily","title":"WaterLily.measure!","text":"measure!(flow::Flow, body::AbstractBody; t=0, ϵ=1)\n\nQueries the body geometry to fill the arrays:\n\nflow.μ₀, Zeroth kernel moment\nflow.μ₁, First kernel moment scaled by the body normal\nflow.V,  Body velocity\n\nat time t using an immersion kernel of size ϵ.\n\nSee Maertens & Weymouth, doi:10.1016/j.cma.2014.09.007.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.measure-Tuple{AutoBody, Any, Any}","page":"WaterLily","title":"WaterLily.measure","text":"d,n,V = measure(body::AutoBody||Bodies,x,t;fastd²=Inf)\n\nDetermine the implicit geometric properties from the sdf and map. The gradient of d=sdf(map(x,t)) is used to improve d for pseudo-sdfs. The velocity is determined solely from the optional map function. Skips the n,V calculation when d²>fastd².\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.measure_sdf!","page":"WaterLily","title":"WaterLily.measure_sdf!","text":"measure_sdf!(a::AbstractArray, body::AbstractBody, t=0)\n\nUses sdf(body,x,t) to fill a.\n\n\n\n\n\n","category":"function"},{"location":"#WaterLily.mom_step!-Union{Tuple{N}, Tuple{Flow{N, T} where T, AbstractPoisson}} where N","page":"WaterLily","title":"WaterLily.mom_step!","text":"mom_step!(a::Flow,b::AbstractPoisson)\n\nIntegrate the Flow one time step using the Boundary Data Immersion Method and the AbstractPoisson pressure solver to project the velocity onto an incompressible flow.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.mult!-Tuple{Poisson, Any}","page":"WaterLily","title":"WaterLily.mult!","text":"mult!(p::Poisson,x)\n\nEfficient function for Poisson matrix-vector multiplication.  Fills p.z = p.A x with 0 in the ghost cells.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.nds-Tuple{Any, Any, Any}","page":"WaterLily","title":"WaterLily.nds","text":"nds(body,x,t)\n\nBDIM-masked surface normal.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.pcg!-Union{Tuple{Poisson{T, S, V} where {S<:(AbstractArray{T}), V<:(AbstractArray{T})}}, Tuple{T}} where T","page":"WaterLily","title":"WaterLily.pcg!","text":"pcg!(p::Poisson; it=6)\n\nConjugate-Gradient smoother with Jacobi preditioning. Runs at most it iterations,  but will exit early if the Gram-Schmidt update parameter |α| < 1% or |r D⁻¹ r| < 1e-8. Note: This runs for general backends and is the default smoother.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.perBC!-Tuple{Any, Tuple{}}","page":"WaterLily","title":"WaterLily.perBC!","text":"perBC!(a,perdir)\n\nApply periodic conditions to the ghost cells of a scalar field.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.pressure_force-Tuple{Any}","page":"WaterLily","title":"WaterLily.pressure_force","text":"pressure_force(sim::Simulation)\n\nCompute the pressure force on an immersed body.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.pressure_moment-Tuple{Any, Any}","page":"WaterLily","title":"WaterLily.pressure_moment","text":"pressure_moment(x₀,sim::Simulation)\n\nComputes the pressure moment on an immersed body relative to point x₀.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.reduce_sdf_map-NTuple{7, Any}","page":"WaterLily","title":"WaterLily.reduce_sdf_map","text":"reduce_sdf_map(sdf_a,map_a,d_a,sdf_b,map_b,d_b,op,x,t)\n\nReduces two different sdf and map functions, and d value.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.residual!-Tuple{Poisson}","page":"WaterLily","title":"WaterLily.residual!","text":"residual!(p::Poisson)\n\nComputes the resiual r = z-Ax and corrects it such that r = 0 if iD==0 which ensures local satisfiability     and  sum(r) = 0 which ensures global satisfiability.\n\nThe global correction is done by adjusting all points uniformly,  minimizing the local effect. Other approaches are possible.\n\nNote: These corrections mean x is not strictly solving Ax=z, but without the corrections, no solution exists.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.sdf-Tuple{AutoBody, Any, Any}","page":"WaterLily","title":"WaterLily.sdf","text":"d = sdf(body::AutoBody,x,t) = body.sdf(x,t)\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.sdf-Tuple{Bodies, Any, Any}","page":"WaterLily","title":"WaterLily.sdf","text":"d = sdf(a::Bodies,x,t)\n\nComputes distance for Bodies type.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.sdf_map_d-NTuple{4, Any}","page":"WaterLily","title":"WaterLily.sdf_map_d","text":"sdf_map_d(ab::Bodies,x,t)\n\nReturns the sdf and map functions, and the distance d (d=sdf(x,t)) for the Bodies type.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.sim_step!-Tuple{Simulation, Any}","page":"WaterLily","title":"WaterLily.sim_step!","text":"sim_step!(sim::Simulation,t_end=sim(time)+Δt;max_steps=typemax(Int),remeasure=true,verbose=false)\n\nIntegrate the simulation sim up to dimensionless time t_end. If remeasure=true, the body is remeasured at every time step. Can be set to false for static geometries to speed up simulation.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.sim_time-Tuple{Simulation}","page":"WaterLily","title":"WaterLily.sim_time","text":"sim_time(sim::Simulation)\n\nReturn the current dimensionless time of the simulation tU/L where t=sum(Δt), and U,L are the simulation velocity and length scales.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.slice-Union{Tuple{N}, Tuple{NTuple{N, T} where T, Any, Any}, Tuple{NTuple{N, T} where T, Any, Any, Any}} where N","page":"WaterLily","title":"WaterLily.slice","text":"slice(dims,i,j,low=1)\n\nReturn CartesianIndices range slicing through an array of size dims in dimension j at index i. low optionally sets the lower extent of the range in the other dimensions.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.solver!-Tuple{Poisson}","page":"WaterLily","title":"WaterLily.solver!","text":"solver!(A::Poisson;log,tol,itmx)\n\nApproximate iterative solver for the Poisson matrix equation Ax=b.\n\nA: Poisson matrix with working arrays.\nA.x: Solution vector. Can start with an initial guess.\nA.z: Right-Hand-Side vector. Will be overwritten!\nA.n[end]: stores the number of iterations performed.\nlog: If true, this function returns a vector holding the L₂-norm of the residual at each iteration.\ntol: Convergence tolerance on the L₂-norm residual.\nitmx: Maximum number of iterations.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.time-Tuple{Flow}","page":"WaterLily","title":"WaterLily.time","text":"time(a::Flow)\n\nCurrent flow time.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.total_force-Tuple{Any}","page":"WaterLily","title":"WaterLily.total_force","text":"total_force(sim::Simulation)\n\nCompute the total force on an immersed body.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.viscous_force-Tuple{Any}","page":"WaterLily","title":"WaterLily.viscous_force","text":"viscous_force(sim::Simulation)\n\nCompute the viscous force on an immersed body.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.δ-Union{Tuple{N}, Tuple{Any, Val{N}}} where N","page":"WaterLily","title":"WaterLily.δ","text":"δ(i,N::Int)\nδ(i,I::CartesianIndex{N}) where {N}\n\nReturn a CartesianIndex of dimension N which is one at index i and zero elsewhere.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.λ₂-Tuple{CartesianIndex{3}, Any}","page":"WaterLily","title":"WaterLily.λ₂","text":"λ₂(I::CartesianIndex{3},u)\n\nλ₂ is a deformation tensor metric to identify vortex cores. See https://en.wikipedia.org/wiki/Lambda2_method and Jeong, J., & Hussain, F., doi:10.1017/S0022112095000462\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.ω-Tuple{CartesianIndex{3}, Any}","page":"WaterLily","title":"WaterLily.ω","text":"ω(I::CartesianIndex{3},u)\n\nCompute 3-vector 𝛚=𝐮 at the center of cell I.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.ω_mag-Tuple{CartesianIndex{3}, Any}","page":"WaterLily","title":"WaterLily.ω_mag","text":"ω_mag(I::CartesianIndex{3},u)\n\nCompute 𝛚 at the center of cell I.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.ω_θ-Tuple{CartesianIndex{3}, Any, Any, Any}","page":"WaterLily","title":"WaterLily.ω_θ","text":"ω_θ(I::CartesianIndex{3},z,center,u)\n\nCompute 𝛚𝛉 at the center of cell I where 𝛉 is the azimuth direction around vector z passing through center.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.∂-NTuple{4, Any}","page":"WaterLily","title":"WaterLily.∂","text":"∂(i,j,I,u)\n\nCompute uᵢxⱼ at center of cell I. Cross terms are computed less accurately than inline terms because of the staggered grid.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.∇²u-Tuple{CartesianIndex{2}, Any}","page":"WaterLily","title":"WaterLily.∇²u","text":"∇²u(I::CartesianIndex,u)\n\nRate-of-strain tensor.\n\n\n\n\n\n","category":"method"},{"location":"#WaterLily.@inside-Tuple{Any}","page":"WaterLily","title":"WaterLily.@inside","text":"@inside <expr>\n\nSimple macro to automate efficient loops over cells excluding ghosts. For example,\n\n@inside p[I] = sum(loc(0,I))\n\nbecomes\n\n@loop p[I] = sum(loc(0,I)) over I ∈ inside(p)\n\nSee @loop.\n\n\n\n\n\n","category":"macro"},{"location":"#WaterLily.@loop-Tuple","page":"WaterLily","title":"WaterLily.@loop","text":"@loop <expr> over <I ∈ R>\n\nMacro to automate fast loops using @simd when running in serial, or KernelAbstractions when running multi-threaded CPU or GPU.\n\nFor example\n\n@loop a[I,i] += sum(loc(i,I)) over I ∈ R\n\nbecomes\n\n@simd for I ∈ R\n    @fastmath @inbounds a[I,i] += sum(loc(i,I))\nend\n\non serial execution, or\n\n@kernel function kern(a,i,@Const(I0))\n    I ∈ @index(Global,Cartesian)+I0\n    @fastmath @inbounds a[I,i] += sum(loc(i,I))\nend\nkern(get_backend(a),64)(a,i,R[1]-oneunit(R[1]),ndrange=size(R))\n\nwhen multi-threading on CPU or using CuArrays. Note that get_backend is used on the first variable in expr (a in this example).\n\n\n\n\n\n","category":"macro"}]
}
