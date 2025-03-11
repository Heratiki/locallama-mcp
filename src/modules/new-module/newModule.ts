import NewComponent from './newComponent.js';

class NewModule {
  private newComponent: NewComponent;

  constructor() {
    this.newComponent = new NewComponent();
  }

  public addDataToComponent(data: any): void {
    this.newComponent.addData(data);
  }

  public getDataFromComponent(): any[] {
    return this.newComponent.getData();
  }
}

export default NewModule;
