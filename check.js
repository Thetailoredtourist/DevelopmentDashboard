const babel=require('@babel/core');
try{babel.transformFileSync('lib/parseExcel.js',{presets:[['@babel/preset-env',{modules:false}]],babelrc:false,configFile:false});console.log('PASS parseExcel');}
catch(e){console.log('FAIL',String(e.message).split('\n').slice(0,3).join('|'));process.exit(1);}
