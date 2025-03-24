interface DataItem {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
}

class NewComponent {
  private data: DataItem[] = [];
  private dataMap: Map<string, DataItem> = new Map();

  public addData(item: DataItem): void {
    this.data.push(item);
    this.dataMap.set(item.id, item);
  }

  public getData(): DataItem[] {
    return this.data;
  }

  public getDataById(id: string): DataItem | undefined {
    return this.dataMap.get(id);
  }
}

export default NewComponent;
