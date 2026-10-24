// error undefined:undefined no compilation info
// label: vertex_ShadowMaterial
// Three.js r186 - Node System

// directives


// structs


// uniforms

struct NodeBuffer_138241Struct {
	value : array< mat4x4<f32>, 128 >
};
@binding( 3 ) @group( 1 )
var<uniform> NodeBuffer_138241 : NodeBuffer_138241Struct;

struct objectStruct {
	nodeUniform1 : f32,
	nodeUniform2 : vec3<f32>,
	nodeUniform3 : f32,
	nodeUniform4 : mat4x4<f32>,
	nodeUniform5 : vec3<f32>,
	nodeUniform6 : f32,
	nodeUniform8 : f32,
	nodeUniform10 : f32,
	nodeUniform11 : f32,
	nodeUniform12 : f32,
	nodeUniform13 : vec2<f32>,
	nodeUniform14 : f32,
	nodeUniform15 : f32,
	nodeUniform16 : f32,
	nodeUniform17 : vec2<f32>,
	nodeUniform18 : f32,
	nodeUniform19 : f32,
	nodeUniform20 : f32,
	nodeUniform21 : f32,
	nodeUniform22 : f32,
	nodeUniform23 : vec2<f32>,
	nodeUniform24 : vec4<f32>,
	nodeUniform25 : vec2<f32>,
	nodeUniform26 : vec4<f32>,
	nodeUniform27 : vec2<f32>,
	nodeUniform28 : vec4<f32>,
	nodeUniform29 : vec2<f32>,
	nodeUniform30 : vec4<f32>,
	nodeUniform31 : f32,
	nodeUniform32 : f32,
	nodeUniform33 : f32,
	nodeUniform34 : f32,
	nodeUniform35 : f32,
	nodeUniform36 : f32,
	nodeUniform37 : vec3<f32>,
	nodeUniform38 : f32,
	nodeUniform39 : f32
};
@binding( 0 ) @group( 1 )
var<uniform> object : objectStruct;

struct renderStruct {
	cameraProjectionMatrix : mat4x4<f32>,
	cameraViewMatrix : mat4x4<f32>,
	cameraPosition : vec3<f32>
};
@binding( 0 ) @group( 0 )
var<uniform> render : renderStruct;

// varyings

struct VaryingsStruct {
	@location( 0 ) nodeVarying3 : vec3<f32>,
	@location( 1 ) v_positionWorld : vec3<f32>,
	@location( 2 ) nodeVarying6 : vec4<f32>,
	@builtin( position ) builtinClipSpace : vec4<f32>
};
var<private> varyings : VaryingsStruct;

// vars
var<private> normalLocal : vec3<f32>;
var<private> modelViewMatrix : mat4x4<f32>;
var<private> VERTEX_nodeVar216 : vec4<f32>;
var<private> positionLocal : vec3<f32>;
var<private> v_modelViewProjection : vec4<f32>;
var<private> v_positionView : vec3<f32>;
var<private> VERTEX_v_modelViewProjection : vec4<f32>;

// codes

fn tsl_inverse_mat3( m : mat3x3<f32> ) -> mat3x3<f32> {

	let a00 = m[ 0 ][ 0 ]; let a01 = m[ 0 ][ 1 ]; let a02 = m[ 0 ][ 2 ];
	let a10 = m[ 1 ][ 0 ]; let a11 = m[ 1 ][ 1 ]; let a12 = m[ 1 ][ 2 ];
	let a20 = m[ 2 ][ 0 ]; let a21 = m[ 2 ][ 1 ]; let a22 = m[ 2 ][ 2 ];

	let b01 = a22 * a11 - a12 * a21;
	let b11 = - a22 * a10 + a12 * a20;
	let b21 = a21 * a10 - a11 * a20;

	let det = a00 * b01 + a01 * b11 + a02 * b21;

	return mat3x3<f32>(
		b01, ( - a22 * a01 + a02 * a21 ), ( a12 * a01 - a02 * a11 ),
		b11, ( a22 * a00 - a02 * a20 ), ( - a12 * a00 + a02 * a10 ),
		b21, ( - a21 * a00 + a01 * a20 ), ( a11 * a00 - a01 * a10 )
	) * ( 1.0 / det );

}



@vertex
fn main( @builtin( instance_index ) instanceIndex : u32,
	@location( 0 ) position : vec3<f32>,
	@location( 1 ) normal : vec3<f32>,
	@location( 2 ) color : vec3<f32> ) -> VaryingsStruct {

	// flow
	// code

	positionLocal = position;
	positionLocal = ( NodeBuffer_138241.value[ instanceIndex ] * vec4<f32>( positionLocal, 1.0 ) ).xyz;
	normalLocal = normal;
	normalLocal = normalize( ( transpose( tsl_inverse_mat3( mat3x3<f32>( NodeBuffer_138241.value[ instanceIndex ][ 0 ].xyz, NodeBuffer_138241.value[ instanceIndex ][ 1 ].xyz, NodeBuffer_138241.value[ instanceIndex ][ 2 ].xyz ) ) ) * normalLocal ) );
	varyings.nodeVarying6 = vec4<f32>( color, 1.0 );
	varyings.nodeVarying3 = normalLocal;
	varyings.v_positionWorld = ( object.nodeUniform4 * vec4<f32>( positionLocal, 1.0 ) ).xyz;
	modelViewMatrix = ( render.cameraViewMatrix * object.nodeUniform4 );
	v_positionView = ( modelViewMatrix * vec4<f32>( positionLocal, 1.0 ) ).xyz;
	VERTEX_nodeVar216 = ( render.cameraProjectionMatrix * vec4<f32>( v_positionView, 1.0 ) );
	VERTEX_v_modelViewProjection = VERTEX_nodeVar216;

	// result

	varyings.builtinClipSpace = VERTEX_v_modelViewProjection;

	return varyings;

}
