using WaterLily
using Test
using CUDA: CUDA, @allowscalar
using AMDGPU: AMDGPU

function setup_backends()
    arrays = [Array]
    if CUDA.functional()
        CUDA.allowscalar(false)
        push!(arrays, CUDA.CuArray)
    end
    if AMDGPU.functional()
        AMDGPU.allowscalar(false)
        push!(arrays, AMDGPU.ROCArray)
    end
    return arrays
end

arrays = setup_backends()

@testset "util.jl" begin
    I = CartesianIndex(1,2,3,4)
    @test I+δ(3,I) == CartesianIndex(1,2,4,4)
    @test WaterLily.CI(I,5)==CartesianIndex(1,2,3,4,5)
    @test WaterLily.CIj(3,I,5)==CartesianIndex(1,2,5,4)
    @test WaterLily.CIj(2,CartesianIndex(16,16,16,3),14)==CartesianIndex(16,14,16,3)

    using StaticArrays
    @test loc(3,CartesianIndex(3,4,5)) == SVector(3,4,4.5) .- 1.5
    I = CartesianIndex(rand(2:10,3)...)
    @test loc(0,I) == SVector(I.I...) .- 1.5

    ex,sym = :(a[I,i] = Math.add(p.b[I],func(I,q))),[]
    WaterLily.grab!(sym,ex)
    @test ex == :(a[I, i] = Math.add(b[I], func(I, q)))
    @test sym == [:a, :I, :i, :(p.b), :q]

    # for f ∈ arrays
    for f ∈ [Array]
        p = zeros(4,5) |> f
        apply!(x->x[1]+x[2]+3,p) # add 2×1.5 to move edge to origin
        @test inside(p) == CartesianIndices((2:3,2:4))
        @test inside(p,buff=0) == CartesianIndices(p)
        @test L₂(p) == 187

        u = zeros(5,5,2) |> f
        apply!((i,x)->x[i],u)
        @allowscalar @test [u[i,j,1].-(i-2) for i in 1:3, j in 1:3]==zeros(3,3)

        Ng, D, U = (6, 6), 2, (1.0, 0.5)
        u = rand(Ng..., D) |> f # vector
        σ = rand(Ng...) |> f # scalar
        BC!(u, U)
        BC!(σ)
        @allowscalar @test all(u[1, :, 1] .== U[1]) && all(u[2, :, 1] .== U[1]) && all(u[end, :, 1] .== U[1]) &&
                all(u[3:end-1, 1, 1] .== u[3:end-1, 2, 1]) && all(u[3:end-1, end, 1] .== u[3:end-1, end-1, 1])
        @allowscalar @test all(u[:, 1, 2] .== U[2]) && all(u[:, 2, 2] .== U[2]) && all(u[:, end, 2] .== U[2]) &&
                all(u[1, 3:end-1, 2] .== u[2, 3:end-1, 2]) && all(u[end, 3:end-1, 2] .== u[end-1, 3:end-1, 2])
        @allowscalar @test all(σ[1, 2:end-1] .== σ[2, 2:end-1]) && all(σ[end, 2:end-1] .== σ[end-1, 2:end-1]) &&
                all(σ[2:end-1, 1] .== σ[2:end-1, 2]) && all(σ[2:end-1, end] .== σ[2:end-1, end-1])

        @allowscalar u[end,:,1] .= 3
        BC!(u,U,true) # save exit values
        @allowscalar @test all(u[end, :, 1] .== 3)

        WaterLily.exitBC!(u,u,U,0) # conservative exit check
        @allowscalar @test all(u[end,2:end-1, 1] .== U[1])

        BC!(u,U,true,(2,)) # periodic in y and save exit values
        @allowscalar @test all(u[:, 1:2, 1] .== u[:, end-1:end, 1]) && all(u[:, 1:2, 1] .== u[:,end-1:end,1])
        BC!(σ;perdir=(1,2)) # periodic in two directions
        @allowscalar @test all(σ[1, 2:end-1] .== σ[end-1, 2:end-1]) && all(σ[2:end-1, 1] .== σ[2:end-1, end-1])
        
        u = rand(Ng..., D) |> f # vector
        BC!(u,U,true,(1,)) #saveexit has no effect here as x-periodic
        @allowscalar @test all(u[1:2, :, 1] .== u[end-1:end, :, 1]) && all(u[1:2, :, 2] .== u[end-1:end, :, 2]) &&
                           all(u[:, 1, 2] .== U[2]) && all(u[:, 2, 2] .== U[2]) && all(u[:, end, 2] .== U[2])
    end
end

function Poisson_setup(poisson,N::NTuple{D};f=Array,T=Float32) where D
    c = ones(T,N...,D) |> f; BC!(c, ntuple(zero,D))
    x = zeros(T,N) |> f; z = copy(x)
    pois = poisson(x,c,z)
    soln = map(I->T(I.I[1]),CartesianIndices(N)) |> f
    I = first(inside(x))
    @allowscalar @. soln -= soln[I]
    z = mult!(pois,soln)
    solver!(pois)
    @allowscalar @. x -= x[I]
    return L₂(x-soln)/L₂(soln),pois
end

@testset "Poisson.jl" begin
    for f ∈ arrays
        err,pois = Poisson_setup(Poisson,(5,5);f)
        @test @allowscalar parent(pois.D)==f(Float32[0 0 0 0 0; 0 -2 -3 -2 0; 0 -3 -4 -3 0;  0 -2 -3 -2 0; 0 0 0 0 0])
        @test @allowscalar parent(pois.iD)≈f(Float32[0 0 0 0 0; 0 -1/2 -1/3 -1/2 0; 0 -1/3 -1/4 -1/3 0;  0 -1/2 -1/3 -1/2 0; 0 0 0 0 0])
        @test err < 1e-5
        err,pois = Poisson_setup(Poisson,(2^6+2,2^6+2);f)
        @test err < 1e-6
        @test pois.n[] < 310
        err,pois = Poisson_setup(Poisson,(2^4+2,2^4+2,2^4+2);f)
        @test err < 1e-6
        @test pois.n[] < 35
    end
end

@testset "MultiLevelPoisson.jl" begin
    I = CartesianIndex(4,3,2)
    @test all(WaterLily.down(J)==I for J ∈ WaterLily.up(I))
    @test_throws AssertionError("MultiLevelPoisson requires size=a2ⁿ, where n>2") Poisson_setup(MultiLevelPoisson,(15+2,3^4+2))

    err,pois = Poisson_setup(MultiLevelPoisson,(10,10))
    @test pois.levels[3].D == Float32[0 0 0 0; 0 -2 -2 0; 0 -2 -2 0; 0 0 0 0]
    @test err < 1e-5

    pois.levels[1].L[5:6,:,1].=0
    WaterLily.update!(pois)
    @test pois.levels[3].D == Float32[0 0 0 0; 0 -1 -1 0; 0 -1 -1 0; 0 0 0 0]

    for f ∈ arrays
        err,pois = Poisson_setup(MultiLevelPoisson,(2^6+2,2^6+2);f)
        @test err < 1e-6
        @test pois.n[] < 3
        err,pois = Poisson_setup(MultiLevelPoisson,(2^4+2,2^4+2,2^4+2);f)
        @test err < 1e-6
        @test pois.n[] < 3
    end
end

@testset "Flow.jl" begin
    # test than vanLeer behaves correctly
    vanLeer = WaterLily.vanLeer
    @test vanLeer(1,0,1) == 0 && vanLeer(1,2,1) == 2 # larger or smaller than both u,d revetrs to itlsef
    @test vanLeer(1,2,3) == 2.5 && vanLeer(3,2,1) == 1.5 # if c is between u,d, limiter is quadratic

    # Check QUICK scheme on boundary
    ϕuL = WaterLily.ϕuL
    ϕuR = WaterLily.ϕuR
    quick = WaterLily.quick
    ϕ = WaterLily.ϕ
    
    # inlet with positive flux -> CD
    @test ϕuL(1,CartesianIndex(2),[0.,0.5,2.],1)==ϕ(1,CartesianIndex(2),[0.,0.5,2.0])
    # inlet negative flux -> backward QUICK
    @test ϕuL(1,CartesianIndex(2),[0.,0.5,2.],-1)==-quick(2.0,0.5,0.0)
    # outlet, positive flux -> standard QUICK
    @test ϕuR(1,CartesianIndex(3),[0.,0.5,2.],1)==quick(0.0,0.5,2.0)
    # outlet, negative flux -> backward CD
    @test ϕuR(1,CartesianIndex(3),[0.,0.5,2.],-1)==-ϕ(1,CartesianIndex(3),[0.,0.5,2.0])

    # check that ϕuSelf is the same as ϕu if explicitly provided with the same indices
    ϕu = WaterLily.ϕu
    ϕuP = WaterLily.ϕuP
    λ = WaterLily.quick

    I = CartesianIndex(3); # 1D check, positive flux
    @test ϕu(1,I,[0.,0.5,2.],1)==ϕuP(1,I-2δ(1,I),I,[0.,0.5,2.],1);
    I = CartesianIndex(2); # 1D check, negative flux
    @test ϕu(1,I,[0.,0.5,2.],-1)==ϕuP(1,I-2δ(1,I),I,[0.,0.5,2.],-1);

    # check for periodic flux
    I=CartesianIndex(3);Ip=I-2δ(1,I);
    f = [1.,1.25,1.5,1.75,2.];
    @test ϕuP(1,Ip,I,f,1)==λ(f[Ip],f[I-δ(1,I)],f[I])
    Ip = WaterLily.CIj(1,I,length(f)-2); # make periodic
    @test ϕuP(1,Ip,I,f,1)==λ(f[Ip],f[I-δ(1,I)],f[I])

    # check for applying the body force
    N = 4
    a = rand(N,N,2)
    WaterLily.accelerate!(a,1,nothing)
    @test all(a .== 0)
    WaterLily.accelerate!(a,1,(i,t) -> i==1 ? t : 2*t)
    @test all(a[:,:,1] .== 1) && all(a[:,:,2] .== 2)

    # Impulsive flow in a box
    U = (2/3, -1/3)
    N = (2^4, 2^4)
    for f ∈ arrays
        a = Flow(N, U; f, T=Float32)
        mom_step!(a, MultiLevelPoisson(a.p,a.μ₀,a.σ))
        @test L₂(a.u[:,:,1].-U[1]) < 2e-5
        @test L₂(a.u[:,:,2].-U[2]) < 1e-5
    end
end

@testset "Body.jl" begin
    @test WaterLily.μ₀(3,6)==WaterLily.μ₀(0.5,1)
    @test WaterLily.μ₀(0,1)==0.5
    @test WaterLily.μ₁(0,2)==2*(1/4-1/π^2)
end

@testset "AutoBody.jl" begin
    norm2(x) = √sum(abs2,x)
    # test AutoDiff in 2D and 3D
    body1 = AutoBody((x,t)->norm2(x)-2-t)
    @test all(measure(body1,[√2.,√2.],0.).≈(0,[√.5,√.5],[0.,0.]))
    @test all(measure(body1,[2.,0.,0.],1.).≈(-1.,[1.,0.,0.],[0.,0.,0.]))
    body2 = AutoBody((x,t)->norm2(x)-2,(x,t)->x.+t^2)
    @test all(measure(body2,[√2.,√2.],0.).≈(0,[√.5,√.5],[0.,0.]))
    @test all(measure(body2,[1.,-1.,-1.],1.).≈(0.,[1.,0.,0.],[-2.,-2.,-2.]))

    #test booleans
    @test all(measure(body1+body2,[-√2.,-√2.],1.).≈(-√2.,[-√.5,-√.5],[-2.,-2.]))
    @test all(measure(body1-body2,[-√2.,-√2.],1.).≈(√2.,[√.5,√.5],[-2.,-2.]))
end

using StaticArrays
function get_flow(N,f)
    a = Flow((N,N),(1.,0.);f,T=Float32)
    @inside a.p[I] = loc(0, I)[2]
    sdf(x,t) = √sum(abs2,x.-(N/2))-N÷4
    map(x,t) = x.-SVector(t,0)
    body = AutoBody(sdf,map)
    WaterLily.measure!(a,body)
    return a,body
end
function TGVsim(mem;T=Float32,perdir=(1,2))
    # Define vortex size, velocity, viscosity
    L = 64; κ=2π/L; ν = 1/(κ*1e8);
    # TGV vortex in 2D
    function TGV(i,xy,t,κ,ν)
        x,y = @. (xy)*κ  # scaled coordinates
        i==1 && return -sin(x)*cos(y)*exp(-2*κ^2*ν*t) # u_x
        return          cos(x)*sin(y)*exp(-2*κ^2*ν*t) # u_y
    end
    # Initialize simulation
    return Simulation((L,L),(0,0),L;U=1,uλ=(i,x)->TGV(i,x,0.0,κ,ν),ν,T,mem,perdir),TGV
end
@testset "Flow.jl periodic TGV" begin
    for f ∈ arrays
        sim,TGV = TGVsim(f); ue=copy(sim.flow.u) |> Array
        sim_step!(sim,π/100)
        apply!((i,x)->TGV(i,x,WaterLily.time(sim),2π/sim.L,sim.flow.ν),ue)
        u = sim.flow.u |> Array
        @test WaterLily.L₂(u[:,:,1].-ue[:,:,1]) < 1e-4 &&
              WaterLily.L₂(u[:,:,2].-ue[:,:,2]) < 1e-4
    end
end

function acceleratingFlow(N;T=Float64,perdir=(1,),jerk=4,gy=0,mem=Array)
    NN = (N,N)
    L = N
    grav = 1
    U = √(grav*L)
    g(i,t) = i==1 ? t*jerk : gy
    ν = 0.001
    return WaterLily.Simulation(
        NN, (U,0.), N; ν,g,U,Δt=0.001,perdir,T,mem
    )
end
@testset "Flow.jl with time-varying body force" begin
    for f∈arrays
        N = 16
        # test accelerating flow (using periodic condition)
        jerk = 4; sim = acceleratingFlow(N;jerk,mem=f)
        sim_step!(sim,1.0); timeExact = WaterLily.time(sim)
        uFinal = sim.flow.U[1] + 0.5*jerk*timeExact^2
        u = sim.flow.u |> Array
        @test (
            WaterLily.L₂(u[:,:,1].-uFinal) < 1e-4 &&
            WaterLily.L₂(u[:,:,2].-0) < 1e-4
        )
        # test hydrostatic pressure field (using periodic condition)
        N=8
        jerk = 0; gy = 1; sim = acceleratingFlow(N;jerk,gy,mem=f)
        sim_step!(sim,1.0); timeExact = WaterLily.time(sim)
        p = sim.flow.p |> Array
        BC!(p,perdir=sim.flow.perdir)
        pe = copy(sim.flow.p) |> Array; apply!((x)->sim.flow.g(2,timeExact)*(x[2]-N/2),pe)
        BC!(pe,perdir=sim.flow.perdir)
        @test WaterLily.L₂(p .- pe) < 5e-3 # the error due to accumulation of pressure solver tolerance
    end
end

@testset "Flow.jl with Body.jl" begin
    # Horizontally moving body
    for f ∈ arrays
        a,_ = get_flow(20,f)
        mom_step!(a,Poisson(a.p,a.μ₀,a.σ))
        @test mapreduce(abs2,+,a.u[:,5,1].-1) < 6e-5
    end
end
import WaterLily: ×
@testset "Metrics.jl" begin
    J = CartesianIndex(2,3,4); x = loc(0,J); px = prod(x)
    for f ∈ arrays
        u = zeros(3,4,5,3) |> f; apply!((i,x)->x[i]+prod(x),u)
        p = zeros(3,4,5) |> f
        @inside p[I] = WaterLily.ke(I,u)
        @test @allowscalar p[J]==0.5*sum(abs2,x .+ px)
        @inside p[I] = WaterLily.ke(I,u,x)
        @test @allowscalar p[J]==1.5*px^2
        @inside p[I] = WaterLily.λ₂(I,u)
        @test @allowscalar p[J]≈1
        ω = (1 ./ x)×repeat([px],3)
        @inside p[I] = WaterLily.curl(2,I,u)
        @test @allowscalar p[J]==ω[2]
        f==Array && @test WaterLily.ω(J,u)≈ω
        @inside p[I] = WaterLily.ω_mag(I,u)
        @test @allowscalar p[J]==sqrt(sum(abs2,ω))
        @inside p[I] = WaterLily.ω_θ(I,(0,0,1),x .+ (0,1,2),u)
        @test @allowscalar p[J]≈ω[1]

        N = 32
        a,body = get_flow(N,f)
        force = WaterLily.∮nds(a.p,a.V,body)
        @test sum(abs,force/(π*(N/4)^2) - [0,1]) < 2e-3
    end
end

function sphere_sim(radius = 8; mem=Array, exitBC=false)
    body = AutoBody((x,t)-> √sum(abs2,x .- 2radius) - radius)
    return Simulation(radius.*(6,4),(1,0),radius; body, ν=radius/250, T=Float32, mem, exitBC)
end
@testset "WaterLily.jl" begin
    for mem ∈ arrays, exitBC ∈ (true,false)
        sim = sphere_sim(;mem,exitBC);
        @test sim_time(sim) == 0
        sim_step!(sim,0.1,remeasure=false)
        @test length(sim.flow.Δt)-1 == length(sim.pois.n)÷2
    end
end
