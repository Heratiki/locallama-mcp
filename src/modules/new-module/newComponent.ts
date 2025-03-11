class NewComponent {
  private data: any[] = [];
  private dataMap: Map<string, any> = new Map();

  public addData(item: any): void {
    this.data.push(item);
    this.dataMap.set(item.id, item);
  }

  public getData(): any[] {
    return this.data;
  }

  public getDataById(id: string): any {
    return this.dataMap.get(id);
  }
}

export default NewComponent;
