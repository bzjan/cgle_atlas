/* 
 * Complex Ginzburg Landau simulation with GPU shaders
 *
 * ©2020 Jan Totz.
 * jantotz at mit.edu
 * 
 * v1.3
 */


// read variables
var glcanvas;				// reference to simulation canvas

// global read/write variables
var b = -0.47;
var c = 1.11;
var brushx = -1;
var brushy = -1;

var W, H;				// width and height of simulation canvas
var mMouseX, mMouseY;	// mouse position on simulation canvas
var mMouseDown = false;
var runningQ = false;
var pauseQ = false;


// do nothing if no button is clicked
function main() {}


// run simulation if button is clicked (see onclick="run()" setting in html for button control)
async function run() {
	
	if(!runningQ){
		// initialization of memory
		
		// initialize webgl
		if(!window.WebGLRenderingContext) {
			fail('Error: Your browser does not support WebGL');
		} else {
			glcanvas = document.querySelector('#glcanvas');
			W = glcanvas.width;
			H = glcanvas.height;
			var gl = glcanvas.getContext('webgl');
			checkCompatibility(gl);
		}
		
		// TODO: fix warning message
		// enable necessary extensions
		gl.getExtension('WEBGL_color_buffer_float');				// webgl1
		//~ gl.getExtension('EXT_color_buffer_float');					// webgl2
		//~ gl.getExtension('EXT_float_blend');
		
		glcanvas.onmousedown = onMouseDown;
		glcanvas.onmouseup = onMouseUp;
		glcanvas.onmousemove = onMouseMove;
		
		// shaders
		const vertexShaderCode = await loadShaderFileAsync('files/vertex-shader.gl');
		const timestepShaderCode = await loadShaderFileAsync('files/timestep-shader.gl');
		const renderShaderCode = await loadShaderFileAsync('files/render-shader.gl');
		var vertex_shader = createShader(gl, gl.VERTEX_SHADER, vertexShaderCode);
		var timestep_shader = createShader(gl, gl.FRAGMENT_SHADER, timestepShaderCode);
		var render_shader = createShader(gl, gl.FRAGMENT_SHADER, renderShaderCode);
		
		// programs: link vertex to fragment shaders
		var timestep_prog = createAndLinkProgram(gl, vertex_shader, timestep_shader);
		var render_prog = createAndLinkProgram(gl, vertex_shader, render_shader);
		
		
		// initialize programs, set uniform variables (send from JS to gl)
		gl.useProgram(timestep_prog);
		loadVertexData(gl, timestep_prog);
		gl.uniform2f(gl.getUniformLocation(timestep_prog, "u_size"), W, H);				// size of domain
		gl.uniform2f(gl.getUniformLocation(timestep_prog, "brush"), brushx, brushy);	// mouse interaction
		gl.uniform1f(gl.getUniformLocation(timestep_prog, "c1"), b);					// parameter for dynamics
		gl.uniform1f(gl.getUniformLocation(timestep_prog, "c2"), c);					// parameter for dynamics
		
		gl.useProgram(render_prog);
		loadVertexData(gl, render_prog);
		gl.uniform2f(gl.getUniformLocation(render_prog, "u_size"), W, H);
		
		// set initial state
		var initial_state = getInitialState();
		
		// initialize textures and framebuffers
		var t1 = newTexture(gl, initial_state);		// current state
		var t2 = newTexture(gl, null);				// next state
		var fb1 = newFramebuffer(gl, t1);
		var fb2 = newFramebuffer(gl, t2);
		
		// Check the hardware can render to a float framebuffer
		// (https://developer.mozilla.org/en-US/docs/Web/WebGL/WebGL_best_practices)
		gl.useProgram(timestep_prog);
		gl.bindFramebuffer(gl.FRAMEBUFFER, fb1);
		var fb_status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (fb_status != gl.FRAMEBUFFER_COMPLETE) {
			fail("Cannot render to framebuffer: " + fb_status);
		}
		
		function step() {
			if(!pauseQ){
				// update dynamics
				gl.useProgram(timestep_prog);
				gl.uniform2f(gl.getUniformLocation(timestep_prog, "brush"), brushx, brushy);	// mouse interaction
				gl.uniform1f(gl.getUniformLocation(timestep_prog, "c1"), b);					// parameter for dynamics
				gl.uniform1f(gl.getUniformLocation(timestep_prog, "c2"), c);					// parameter for dynamics
				var timeStepsPerFrame = 100;
				for (var i=0; i<timeStepsPerFrame; i++) {
					gl.bindTexture(gl.TEXTURE_2D, [t1, t2][i % 2]);
					gl.bindFramebuffer(gl.FRAMEBUFFER, [fb2, fb1][i % 2]);
					gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				}
				
				// update image
				gl.useProgram(render_prog);
				gl.bindTexture(gl.TEXTURE_2D, t1);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			}
		}
		
		var animationFrame;
		function frame() {
			step();
			animationFrame = requestAnimationFrame(frame);
		}
		
		animationFrame = requestAnimationFrame(frame);
		runningQ = true;
	}
}



async function loadShaderFileAsync(url) {
	const code = await fetch(url);
	return code.text();
}



function getInitialState(){
	var field = new Float32Array(4 * W * H);
	
	var initialConditionChoice = 0;
	
	for(var y=0; y<H; y++){
	for(var x=0; x<W; x++){
		var idx = x + y*W;
		switch(initialConditionChoice){
			case 0:		// random
				field[4*idx + 0] = 2.0*Math.random() - 1.0;
				field[4*idx + 1] = 2.0*Math.random() - 1.0;
				break;
			case 1:			// linear phase gradient
				field[4*idx + 0] = cos(2.0*Math.PI*x/W);
				field[4*idx + 1] = sin(2.0*Math.PI*y/H);
				break;
			default:		// uniform
				field[4*idx + 0] = 1.0;
				field[4*idx + 1] = 0.0;
				break;
		}
	}}
	
	return field;
}


// Create, initialise, and bind a new texture
function newTexture(gl, initial_state) {
	var texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.FLOAT, initial_state);
	
	return texture;
}

function newFramebuffer(gl, texture) {
	var fb = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	
	return fb;
}

function loadVertexData(gl, prog) {
	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1,-1, 1,-1, -1,1, 1,1 ]), gl.STATIC_DRAW);
	
	var a_position = gl.getAttribLocation(prog, "a_position");			// absolute position
	gl.enableVertexAttribArray(a_position);
	gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);
}

function createAndLinkProgram(gl, vertex_shader, fragment_shader) {
	var prog = gl.createProgram();
	gl.attachShader(prog, vertex_shader);
	gl.attachShader(prog, fragment_shader);
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		fail("Failed to link program: " + gl.getProgramInfoLog(prog));
	}
	return prog;
}



function createShader(gl, shader_type, shader_code) {
	var shader = gl.createShader(shader_type);
	gl.shaderSource(shader, shader_code);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		var err = gl.getShaderInfoLog(shader);
		fail("Failed to compile shader: " + err);
	}
	return shader
}

function checkCompatibility(gl) {
	if (!gl) fail("WebGL is not supported");
	
	var float_texture_ext = gl.getExtension("OES_texture_float");
	if (!float_texture_ext) fail("Your browser does not support the WebGL extension OES_texture_float");
	window.float_texture_ext = float_texture_ext; // Hold onto it
	
	var max_texture_size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
	if (max_texture_size < 512) fail("Your browser only supports "+max_texture_size+"×"+max_texture_size+" WebGL textures");
}

function fail(message) {
	var fail = document.createElement("p");
	fail.id = "fail";
	fail.appendChild(document.createTextNode(message));
	document.body.removeChild(document.getElementById("glcanvas"));
	document.body.appendChild(fail);
	throw message;
	return;
}


function pause() {
	
	// change simulation state
	pauseQ = !pauseQ;
	
	// change button appearance
	var btn = document.getElementById("btn_pause");
	if (pauseQ){
		btn.innerHTML = 'Continue';
	}else{
		btn.innerHTML = 'Pause';
	} 
	
	
}


var onMouseMove = function(e) {
	var ev = e ? e : window.event;
	
	mMouseX = ev.pageX - glcanvas.offsetLeft;
	mMouseY = ev.pageY - glcanvas.offsetTop;
	
	if(mMouseDown){
		brushx = mMouseX/(2*W);
		brushy = 1-mMouseY/(2*H);
	}
}

var onMouseDown = function(e) {
	var ev = e ? e : window.event;
	mMouseDown = true;
	
	brushx = mMouseX/(2*W);
	brushy = 1-mMouseY/(2*H);
}

var onMouseUp = function(e) {
	mMouseDown = false;
	brushx = -1;
	brushy = -1;
}




// get mouse position on canvas
function getCursorPosition(canvas, event) {
	const rect = canvas.getBoundingClientRect()
	const x = event.clientX - rect.left;
	const y = event.clientY - rect.top;
	return [x, y];
}


// update clickable overlay canvas
function clickableCanvasOverlay(event,canvas) {
	
	const [xpos,ypos] = getCursorPosition(canvas,event);			// position of mouse in image
	const [x,y] = [xpos-x0, ypos-y0];								// position in grid
	
	// check that mouseclick occurred in good image domain
	if(x >= 0 && x <= nx && y >= 0 && y <= ny){
		const [boxIdx_x,boxIdx_y] = [Math.floor((x+0.5*boxSize_x)/boxSize_x), Math.floor((y+0.5*boxSize_y)/boxSize_y)];		// box index
		const [boxCorner_x,boxCorner_y] = [x0-0.5*boxSize_x+boxIdx_x*boxSize_x,y0-0.5*boxSize_y+boxIdx_y*boxSize_y];
		
		// get b,c values
		[b,c] = [bStart+boxIdx_x*(bEnd-bStart)/nboxes_x,cEnd-boxIdx_y*(cEnd-cStart)/nboxes_y];
		
		// update overview image overlay
		var ctx=canvas.getContext("2d");
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.strokeStyle = "red";
		ctx.strokeRect(boxCorner_x,boxCorner_y,boxSize_x,boxSize_y);
		ctx.strokeStyle = "orange";
		ctx.strokeRect(boxCorner_x+1,boxCorner_y+1,boxSize_x-2,boxSize_y-2);
		ctx.strokeRect(boxCorner_x-1,boxCorner_y-1,boxSize_x+2,boxSize_y+2);
		
		// update state image tab
		var canvas3=document.getElementById("state_image");
		var ctx3=canvas3.getContext("2d");
		var img=new Image();
		img.onload = function () {
			ctx3.drawImage(img,0,0,canvas3.width,canvas3.height);		// draw the image on the canvas
		}
		img.src = "images/xt_state_c1_" + b.toFixed(5) + "_c2_" + c.toFixed(5) + ".png";
		
		// update parameter string
		$('#datapoint').text("b = " + b.toFixed(2) + ", c = " + c.toFixed(2));
		
		//~ console.log("boxIdx_x: " + boxIdx_x + " boxIdx_y: " + boxIdx_y);			// DEBUG
		//~ console.log("b: " + b + " c: " + c);										// DEBUG
	}
}




main();
