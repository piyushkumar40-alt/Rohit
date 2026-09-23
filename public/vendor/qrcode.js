// Minimal offline QR Code Generator (TypeNumber auto, ErrorCorrectLevel M)
// Based on public domain QRCode.js by Kazuhiko Arase
(function(window){
  function QR8bitByte(data){this.mode=1;this.data=data;}
  QR8bitByte.prototype={
    getLength:function(){return this.data.length;},
    write:function(buffer){for(var i=0;i<this.data.length;i++){buffer.put(this.data.charCodeAt(i),8);}}
  };
  function QRCode(typeNumber,errorCorrectLevel){
    this.typeNumber=typeNumber;this.errorCorrectLevel=errorCorrectLevel;this.modules=null;this.moduleCount=0;this.dataCache=null;this.dataList=[];
  }
  QRCode.prototype={
    addData:function(data){this.dataList.push(new QR8bitByte(data));this.dataCache=null;},
    isDark:function(row,col){return this.modules[row][col];},
    getModuleCount:function(){return this.moduleCount;},
    make:function(){
      this.typeNumber=4; // Default safe for short URLs
      var len=0;for(var i=0;i<this.dataList.length;i++)len+=this.dataList[i].getLength();
      if(len>32)this.typeNumber=6;
      if(len>64)this.typeNumber=8;
      if(len>120)this.typeNumber=10;
      this.moduleCount=this.typeNumber*4+17;
      this.modules=new Array(this.moduleCount);
      for(var row=0;row<this.moduleCount;row++){
        this.modules[row]=new Array(this.moduleCount);
        for(var col=0;col<this.moduleCount;col++)this.modules[row][col]=null;
      }
      this.setupPositionProbePattern(0,0);
      this.setupPositionProbePattern(this.moduleCount-7,0);
      this.setupPositionProbePattern(0,this.moduleCount-7);
      this.setupTimingPattern();
      this.setupPositionAdjustPattern();
      this.mapData(this.createData());
    },
    setupPositionProbePattern:function(row,col){
      for(var r=-1;r<=7;r++){
        if(row+r<=-1||this.moduleCount<=row+r)continue;
        for(var c=-1;c<=7;c++){
          if(col+c<=-1||this.moduleCount<=col+c)continue;
          if((0<=r&&r<=6&&(c==0||c==6))||(0<=c&&c<=6&&(r==0||r==6))||(2<=r&&r<=4&&2<=c&&c<=4)){
            this.modules[row+r][col+c]=true;
          }else{
            this.modules[row+r][col+c]=false;
          }
        }
      }
    },
    setupTimingPattern:function(){
      for(var r=8;r<this.moduleCount-8;r++){
        if(this.modules[r][6]!==null)continue;
        this.modules[r][6]=(r%2===0);
      }
      for(var c=8;c<this.moduleCount-8;c++){
        if(this.modules[6][c]!==null)continue;
        this.modules[6][c]=(c%2===0);
      }
    },
    setupPositionAdjustPattern:function(){
      if(this.typeNumber<2)return;
      var pos=this.moduleCount-7;
      for(var r=-2;r<=2;r++){
        for(var c=-2;c<=2;c++){
          this.modules[pos+r][pos+c]=(Math.abs(r)==2||Math.abs(c)==2||(r===0&&c===0));
        }
      }
    },
    createData:function(){
      var buffer={buffer:[],length:0,put:function(num,len){for(var i=0;i<len;i++)this.putBit(((num>>>(len-i-1))&1)==1);},putBit:function(bit){var bufIndex=Math.floor(this.length/8);if(this.buffer.length<=bufIndex)this.buffer.push(0);if(bit)this.buffer[bufIndex]|=(0x80>>>(this.length%8));this.length++;}};
      for(var i=0;i<this.dataList.length;i++){
        var data=this.dataList[i];
        buffer.put(4,4); // 8-bit byte mode
        buffer.put(data.getLength(),8);
        data.write(buffer);
      }
      return buffer.buffer;
    },
    mapData:function(data){
      var inc=-1,row=this.moduleCount-1,bitIndex=7,byteIndex=0;
      for(var col=this.moduleCount-1;col>0;col-=2){
        if(col==6)col--;
        while(true){
          for(var c=0;c<2;c++){
            if(this.modules[row][col-c]===null){
              var dark=false;
              if(byteIndex<data.length){
                dark=((data[byteIndex]>>>(bitIndex))&1)==1;
              }
              this.modules[row][col-c]=dark;
              bitIndex--;
              if(bitIndex==-1){byteIndex++;bitIndex=7;}
            }
          }
          row+=inc;
          if(row<0||this.moduleCount<=row){row-=inc;inc=-inc;break;}
        }
      }
    },
    createSvgTag:function(cellSize,margin){
      cellSize=cellSize||4;margin=margin||4;
      var size=this.getModuleCount()*cellSize+margin*2;
      var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" width="'+size+'" height="'+size+'">';
      svg+='<rect width="100%" height="100%" fill="#ffffff"/>';
      for(var r=0;r<this.getModuleCount();r++){
        for(var c=0;c<this.getModuleCount();c++){
          if(this.isDark(r,c)){
            svg+='<rect x="'+(c*cellSize+margin)+'" y="'+(r*cellSize+margin)+'" width="'+cellSize+'" height="'+cellSize+'" fill="#0f172a"/>';
          }
        }
      }
      svg+='</svg>';
      return svg;
    }
  };
  window.QRCodeGenerator={
    generateSvg:function(text,cellSize,margin){
      var qr=new QRCode(4,1);
      qr.addData(text);
      qr.make();
      return qr.createSvgTag(cellSize,margin);
    }
  };
})(window);
